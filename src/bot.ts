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
          name: GROQ_API_KEY,
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

        changedFiles = files
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
          const url = new URL(file.contents_url)
          const pathname = decodeURIComponent(url.pathname)
          // if includePatterns is not empty, only include files that match the pattern
          if (includePatterns.length) {
            return matchPatterns(includePatterns, pathname)
          }

          if (ignoreList.includes(file.filename)) {
            return false;
          }

          // if ignorePatterns is not empty, ignore files that match the pattern
          if (ignorePatterns.length) {
            return !matchPatterns(ignorePatterns, pathname)
          }

          return true
      })

      if (!changedFiles?.length) {
        log.info('no change found');
        return 'no change';
      }

      console.time('gpt cost');

      const ress = [];

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
          const formattedBody = lgtmStatus ? `> ### ${lgtmStatus}\n\n${reviewComment}` : reviewComment;
          
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
              ress.push(reviewData);
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
          body: ress.length ? "Code review by Compound Reviewer" : "LGTM 👍",
          event: 'COMMENT',
          commit_id: commits[commits.length - 1].sha,
          comments: ress,
        });
      } catch (e) {
        log.info(`Failed to create review`, e);
      }

      console.timeEnd('gpt cost');
      log.info(
        'successfully reviewed',
        context.payload.pull_request.html_url
      );

      return 'success';
    }
  );
};

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