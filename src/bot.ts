import { Context, Probot } from 'probot';
import { minimatch } from 'minimatch'

import { Chat } from './chat.js';
import log from 'loglevel';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MAX_PATCH_COUNT = process.env.MAX_PATCH_LENGTH
  ? +process.env.MAX_PATCH_LENGTH
  : Infinity;

export const robot = (app: Probot) => {
  const loadChat = async (context: Context) => {
    if (GROQ_API_KEY) {
      return new Chat(GROQ_API_KEY);
    }

    const repo = context.repo();

    try {
      const { data } = (await context.octokit.request(
        'GET /repos/{owner}/{repo}/actions/variables/{name}',
        {
          owner: repo.owner,
          repo: repo.repo,
          name: 'GROQ_API_KEY',
        }
      )) as any;

      if (!data?.value) {
        return null;
      }

      return new Chat(data.value);
    } catch {
      await context.octokit.issues.createComment({
        repo: repo.repo,
        owner: repo.owner,
        issue_number: context.pullRequest().pull_number,
        body: `Seems you are using me but didn't get GROQ_API_KEY set in Variables/Secrets for this repo.`,
      });
      return null;
    }
  };

  // Handle mentions in comments
  app.on('issue_comment.created', async (context) => {
    const comment = context.payload.comment;
    const botName = 'compound-reviewer';
    
    log.debug('Received issue_comment.created event', {
      commentId: comment.id,
      commentBody: comment.body,
      author: comment.user?.login,
      issueNumber: context.payload.issue?.number,
      isPullRequest: !!context.payload.issue?.pull_request
    });
    
    // Check if the bot is mentioned at the start of the comment
    const firstWord = comment.body.trim().split(/\s+/)[0];
    
    if (firstWord !== `@${botName}` && firstWord !== botName) {
      log.debug('Bot not mentioned at start of comment, skipping');
      return;
    }

    log.debug('Bot mentioned in comment');

    // Only respond to PR comments
    if (!context.payload.issue?.pull_request) {
      log.debug('Comment is not on a pull request, skipping');
      return;
    }

    log.debug('Comment is on a pull request, proceeding');

    const repo = context.repo();
    log.debug('Repository info', { owner: repo.owner, repo: repo.repo });

    const chat = await loadChat(context);

    if (!chat) {
      log.info('Chat initialization failed for mention response');
      return;
    }

    log.debug('Chat initialized successfully');
    log.debug('Comment body:', comment.body);
    log.debug('Bot name:', botName);
    log.debug('Is pull request:', !!context.payload.issue?.pull_request);
    log.debug('Issue number:', context.payload.issue?.number);
    log.debug('Repository:', { owner: repo.owner, repo: repo.repo });
    log.debug('Chat initialized successfully');

    try {
      // Get PR information
      const prNumber = context.payload.issue.number;
      log.debug('Getting PR information', { prNumber });

      const pullRequest = await context.octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber,
      });

      log.debug('PR information retrieved', {
        title: pullRequest.data.title,
        author: pullRequest.data.user?.login,
        branch: pullRequest.data.head.ref,
        baseBranch: pullRequest.data.base.ref
      });

      // Get PR diff for context
      log.debug('Getting PR diff');
      const prDiff = await context.octokit.pulls.get({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber,
        mediaType: { format: 'diff' },
      });

      log.debug('PR diff retrieved', { diffLength: (prDiff.data as unknown as string).length });

      // Get recent comments for conversation history
      log.debug('Getting recent comments for conversation history');
      const comments = await context.octokit.issues.listComments({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber,
        per_page: 10,
      });

      log.debug('Comments retrieved', { commentCount: comments.data.length });

      // Extract user query from comment (remove mention)
      const userQuery = comment.body
        .replace(new RegExp(`@${botName}`, 'gi'), '')
        .replace(new RegExp(botName, 'gi'), '')
        .trim();

      log.debug('User query extracted', { userQuery });

      // Build context for the AI
      const prContext = {
        title: pullRequest.data.title,
        description: pullRequest.data.body || '',
        author: pullRequest.data.user?.login || 'unknown',
        branch: pullRequest.data.head.ref,
        baseBranch: pullRequest.data.base.ref,
        diff: prDiff.data,
        conversationHistory: comments.data.slice(-5).map(c => ({
          author: c.user?.login || 'unknown',
          body: c.body,
          createdAt: c.created_at,
        })),
      };

      log.debug('PR context built', {
        title: prContext.title,
        author: prContext.author,
        branch: prContext.branch,
        baseBranch: prContext.baseBranch,
        conversationHistoryLength: prContext.conversationHistory.length
      });

      // Generate response using the chat system
      log.debug('Generating response using chat system');
      const response = await chat.respondToMention(userQuery, prContext);

      log.debug('Response generated', { responseLength: response.length });

      // Post the response
      log.debug('Posting response comment');
      await context.octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: prNumber,
        body: response,
      });

      log.info(`Responded to mention in PR #${prNumber}`);
    } catch (error) {
      log.error('Error handling mention:', error);
      
      // Post error response
      await context.octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: context.payload.issue.number,
        body: 'Sorry, I encountered an error while processing your request. Please try again later.',
      });
    }
  });

  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    async (context) => {
      const repo = context.repo();
      const chat = await loadChat(context);

      if (!chat) {
        log.info('Chat initialized failed');
        return 'no chat';
      }

      const pull_request = context.payload.pull_request;

      if (
        pull_request.state === 'closed' ||
        pull_request.locked
      ) {
        log.info('invalid event payload');
        return 'invalid event payload';
      }

      const data = await context.octokit.repos.compareCommits({
        owner: repo.owner,
        repo: repo.repo,
        base: context.payload.pull_request.base.sha,
        head: context.payload.pull_request.head.sha,
      });

      let { files: changedFiles, commits } = data.data;

      if (context.payload.action === 'synchronize' && commits.length >= 2) {
        const {
          data: { files },
        } = await context.octokit.repos.compareCommits({
          owner: repo.owner,
          repo: repo.repo,
          base: commits[commits.length - 2].sha,
          head: commits[commits.length - 1].sha,
        });

        changedFiles = files;
      }

      const ignoreList = (process.env.IGNORE || process.env.ignore || '')
        .split('\n')
        .filter((v) => v !== '');
      const ignorePatterns = (process.env.IGNORE_PATTERNS || '').split(',').filter((v) => Boolean(v.trim()));
      const includePatterns = (process.env.INCLUDE_PATTERNS || '').split(',').filter((v) => Boolean(v.trim()));

      // log.debug('ignoreList:', ignoreList);
      // log.debug('ignorePatterns:', ignorePatterns);
      // log.debug('includePatterns:', includePatterns);

      changedFiles = changedFiles?.filter(
        (file) => {
          const url = new URL(file.contents_url);
          const pathname = decodeURIComponent(url.pathname);
          // if includePatterns is not empty, only include files that match the pattern
          if (includePatterns.length) {
            return matchPatterns(includePatterns, pathname);
          }

          if (ignoreList.includes(file.filename)) {
            return false;
          }

          // if ignorePatterns is not empty, ignore files that match the pattern
          if (ignorePatterns.length) {
            return !matchPatterns(ignorePatterns, pathname);
          }

          return true;
        });

      if (!changedFiles?.length) {
        log.info('no change found');
        return 'no change';
      }

      console.time('total review time');

      const reviews = [];

      for (let i = 0; i < changedFiles.length; i++) {
        const file = changedFiles[i];
        const patch = file.patch || '';

        if (file.status !== 'modified' && file.status !== 'added') {
          continue;
        }

        if (!patch || patch.length > MAX_PATCH_COUNT) {
          log.info(
            `${file.filename} skipped caused by its diff is too large`
          );
          continue;
        }
        try {
          log.debug(`Starting code review for file: ${file.filename}`);
          const res = await chat?.codeReview(patch) as { lgtm: boolean, review_comment: string };
          const lgtm = res.lgtm;
          let reviewComment = res.review_comment;

          // Fix Markdown formatting: replace literal '\\n' with '\n'
          if (typeof reviewComment === 'string') {
            reviewComment = reviewComment.replace(/\\n/g, '\n');
            // If it's a single line with multiple '*', insert '\n' before each '*' (except the first one)
            if (!reviewComment.includes('\n') && (reviewComment.match(/\*/g) || []).length > 1) {
              reviewComment = reviewComment.replace(/\s*\*/g, '\n*').replace(/^\n/, '');
            }
          }

          console.log('lgtm in bot:', lgtm);
          console.log('reviewComment in bot:', reviewComment);
          const lgtmStatus = lgtm ? '✅ LGTM' : '❌ Needs Changes';
          log.debug("================================================")
          log.debug(`LGTM status for ${file.filename}: ${lgtmStatus}`);
          log.debug(`Type of lgtm: ${typeof lgtm}`);
          log.debug("================================================")
          const formattedBody = `> ### ${lgtmStatus}\n\n${reviewComment}`;
          
          const preview = formattedBody?.length > 150 ? `${formattedBody.slice(0, 150)}...` : formattedBody;
          log.debug(`Review comment for ${file.filename}: ${preview}`);

          if (reviewComment) {
            // Robust patch position calculation
            let position = null;
            if (patch) {
              const patchLines = patch.split('\n');
              let lineNumber = 0;
              
              for (let j = 0; j < patchLines.length; j++) {
                const line = patchLines[j];
                
                // Parse hunk header to get starting line number
                if (line.startsWith('@@')) {
                  const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
                  if (match) {
                    lineNumber = parseInt(match[1], 10) - 1; // Convert to 0-based
                  }
                  continue;
                }
                
                // Skip file headers
                if (line.startsWith('---') || line.startsWith('+++')) continue;
                
                // Track line numbers for context and added lines
                if (line.startsWith(' ') || line.startsWith('+')) {
                  lineNumber++;
                }
                
                // Find the first added line for position
                if (line.startsWith('+') && !line.startsWith('+++') && position === null) {
                  position = lineNumber;
                }
              }
            }
            if (position !== null) {
              const reviewData = {
                path: file.filename,
                body: formattedBody,
                position,
              };
              reviews.push(reviewData);
            } else {
              log.debug(`No valid position found in patch for ${file.filename}, skipping comment.`);
            }
          } else {
            log.debug(`No review comment generated for ${file.filename}`);
          }
        } catch (e) {
          log.info(`review ${file.filename} failed`, e);
        }
      }
      try {
        await context.octokit.pulls.createReview({
          repo: repo.repo,
          owner: repo.owner,
          pull_number: context.pullRequest().pull_number,
          body: reviews.length ? "Code review by Compound Reviewer" : "LGTM 👍",
          event: 'COMMENT',
          commit_id: commits[commits.length - 1].sha,
          comments: reviews,
        });
      } catch (e) {
        log.info(`Failed to create review`, e);
      }

      console.timeEnd('total review time');
      log.info(
        'successfully reviewed',
        context.payload.pull_request.html_url
      );

      return 'success';
    }
  );

  app.on('pull_request_review_comment.created', async (context) => {
    const comment = context.payload.comment;
    const botName = 'compound-reviewer';

    // Only respond if bot is mentioned at the start
    const firstWord = comment.body.trim().split(/\s+/)[0];
    if (firstWord !== `@${botName}` && firstWord !== botName) {
      return;
    }

    // Get PR info
    const prNumber = context.payload.pull_request.number;
    const repo = context.repo();
    const chat = await loadChat(context);
    if (!chat) return;

    // Get PR details
    const pullRequest = await context.octokit.pulls.get({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
    });

    // Get PR diff
    const prDiff = await context.octokit.pulls.get({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });

    // Get recent review comments for context
    const reviewComments = await context.octokit.pulls.listReviewComments({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
      per_page: 10,
    });

    // Get the parent comment (the one being replied to)
    let parentComment = null;
    if (comment.in_reply_to_id) {
      parentComment = await context.octokit.pulls.getReviewComment({
        owner: repo.owner,
        repo: repo.repo,
        comment_id: comment.in_reply_to_id,
      });
    }

    // Extract user query
    const userQuery = comment.body
      .replace(new RegExp(`@${botName}`, 'gi'), '')
      .replace(new RegExp(botName, 'gi'), '')
      .trim();

    // Build context for the AI
    const prContext = {
      title: pullRequest.data.title,
      description: pullRequest.data.body || '',
      author: pullRequest.data.user?.login || 'unknown',
      branch: pullRequest.data.head.ref,
      baseBranch: pullRequest.data.base.ref,
      diff: prDiff.data,
      conversationHistory: reviewComments.data.slice(-5).map(c => ({
        author: c.user?.login || 'unknown',
        body: c.body,
        createdAt: c.created_at,
      })),
      parentReviewComment: parentComment ? {
        author: parentComment.data.user?.login || 'unknown',
        body: parentComment.data.body,
        createdAt: parentComment.data.created_at,
      } : null,
    };

    // Generate response using the chat system
    const response = await chat.respondToMention(userQuery, prContext);

    // Quote the original review comment
    const quoted = comment.body
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n');

    // Compose the reply
    const replyBody = `${quoted}\n\n---\n${response}`;

    // Post the response as a new top-level PR comment
    await context.octokit.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: prNumber,
      body: replyBody,
    });
  });

  const matchPatterns = (patterns: string[], path: string) => {
    return patterns.some((pattern) => {
      try {
        return minimatch(path, pattern.startsWith('/') ? "**" + pattern : pattern.startsWith("**") ? pattern : "**/" + pattern);
      } catch {
        // if the pattern is not a valid glob pattern, try to match it as a regular expression
        try {
          return new RegExp(pattern).test(path);
        } catch (e) {
          return false;
        }
      }
    })
  }
}