import { Probot } from 'probot';
import { minimatch } from 'minimatch';

import { Chat } from './chat.js';
import log from 'loglevel';

// Type interfaces - using any for simplicity to avoid complex Probot type issues

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MAX_PATCH_COUNT = process.env.MAX_PATCH_LENGTH
    ? +process.env.MAX_PATCH_LENGTH
    : Infinity;

// Utility functions
const loadChat = async (context: any): Promise<Chat | null> => {
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

const matchPatterns = (patterns: string[], path: string): boolean => {
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
    });
};

const isBotMentioned = (body: string, botName: string): boolean => {
    const firstWord = body.trim().split(/\s+/)[0];
    return firstWord === `@${botName}` || firstWord === botName;
};

const extractUserQuery = (body: string, botName: string): string => {
    return body
        .replace(new RegExp(`@${botName}`, 'gi'), '')
        .replace(new RegExp(botName, 'gi'), '')
        .trim();
};

const buildPRContext = (pullRequest: any, prDiff: any, conversationHistory: any[], parentComment?: any) => {
    return {
        title: pullRequest.data.title,
        description: pullRequest.data.body || '',
        author: pullRequest.data.user?.login || 'unknown',
        branch: pullRequest.data.head.ref,
        baseBranch: pullRequest.data.base.ref,
        diff: prDiff.data,
        conversationHistory: conversationHistory.slice(-5).map(c => ({
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
};

const filterChangedFiles = (changedFiles: any[]) => {
    const ignoreList = (process.env.IGNORE || process.env.ignore || '')
        .split('\n')
        .filter((v) => v !== '');
    const ignorePatterns = (process.env.IGNORE_PATTERNS || '').split(',').filter((v) => Boolean(v.trim()));
    const includePatterns = (process.env.INCLUDE_PATTERNS || '').split(',').filter((v) => Boolean(v.trim()));

    return changedFiles?.filter((file) => {
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
};



const formatReviewComment = (lgtm: boolean, reviewComment: string): string => {
    // Fix Markdown formatting: replace literal '\\n' with '\n'
    if (typeof reviewComment === 'string') {
        reviewComment = reviewComment.replace(/\\n/g, '\n');
        // If it's a single line with multiple '*', insert '\n' before each '*' (except the first one)
        if (!reviewComment.includes('\n') && (reviewComment.match(/\*/g) || []).length > 1) {
            reviewComment = reviewComment.replace(/\s*\*/g, '\n*').replace(/^\n/, '');
        }
    }

    const lgtmStatus = lgtm ? '✅ LGTM' : '❌ Needs Changes';
    return `> ### ${lgtmStatus}\n\n${reviewComment}`;
};

const postErrorComment = async (context: any, issueNumber: number, message: string) => {
    const repo = context.repo();
    await context.octokit.issues.createComment({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: issueNumber,
        body: message,
    });
};

// Event handlers
const handleIssueComment = async (context: any) => {
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
    if (!isBotMentioned(comment.body, botName)) {
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
        const userQuery = extractUserQuery(comment.body, botName);
        log.debug('User query extracted', { userQuery });

        // Build context for the AI
        const prContext = buildPRContext(pullRequest, prDiff, comments.data);

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
        await postErrorComment(context, context.payload.issue.number, 'Sorry, I encountered an error while processing your request. Please try again later.');
    }
};

const handlePullRequestEvents = async (context: any) => {
    const repo = context.repo();
    const chat = await loadChat(context);

    if (!chat) {
        log.info('Chat initialized failed');
        return 'no chat';
    }

    const pull_request = context.payload.pull_request;

    if (pull_request.state === 'closed' || pull_request.locked) {
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

    changedFiles = filterChangedFiles(changedFiles || []);

    if (!changedFiles?.length) {
        log.info('no change found');
        return 'no change';
    }

    console.time('total review time');

    const reviews = await processFileReviews(changedFiles, chat);

    try {
        if (reviews.length > 0) {
            // Create individual comments for each file with issues
            for (const review of reviews) {
                await context.octokit.issues.createComment({
                    repo: repo.repo,
                    owner: repo.owner,
                    issue_number: context.pullRequest().pull_number,
                    body: `## 📄 ${review.path}\n\n${review.body}`,
                });
            }
        } else {
            // Create a simple LGTM comment
            await context.octokit.issues.createComment({
                repo: repo.repo,
                owner: repo.owner,
                issue_number: context.pullRequest().pull_number,
                body: "🚀 **Code Review Complete** - All changes look good! LGTM 👍",
            });
        }
    } catch (e) {
        log.info(`Failed to create review comments`, e);
    }

    console.timeEnd('total review time');
    log.info('successfully reviewed', context.payload.pull_request.html_url);

    return 'success';
};

const analyzePatchContext = (patch: string) => {
    const lines = patch.split('\n');
    let addedLines = 0;
    let deletedLines = 0;
    let contextLines = 0;
    let hasLogicChanges = false;
    let hasStructuralChanges = false;
    let isFormatting = true;

    for (const line of lines) {
        if (line.startsWith('+')) {
            addedLines++;
            const content = line.substring(1).trim();
            if (content && !isWhitespaceOrFormatting(content)) {
                isFormatting = false;
                if (hasLogicalContent(content)) {
                    hasLogicChanges = true;
                }
                if (hasStructuralContent(content)) {
                    hasStructuralChanges = true;
                }
            }
        } else if (line.startsWith('-')) {
            deletedLines++;
            const content = line.substring(1).trim();
            if (content && !isWhitespaceOrFormatting(content)) {
                isFormatting = false;
                if (hasLogicalContent(content)) {
                    hasLogicChanges = true;
                }
            }
        } else if (line.startsWith(' ')) {
            contextLines++;
        }
    }

    return {
        addedLines,
        deletedLines,
        contextLines,
        hasLogicChanges,
        hasStructuralChanges,
        isFormatting,
        isMinorChange: (addedLines + deletedLines) <= 3 && !hasLogicChanges,
        isRefactoring: deletedLines > 0 && addedLines > 0 && !hasStructuralChanges
    };
};

const isWhitespaceOrFormatting = (content: string): boolean => {
    return /^\s*$/.test(content) ||
        /^[{}()\[\];,]*$/.test(content) ||
        /^\s*(import|from)\s/.test(content) ||
        /^\s*(\/\/|\/\*|\*|\*\/|#)/.test(content);
};

const hasLogicalContent = (content: string): boolean => {
    return /\b(if|else|for|while|function|class|return|throw|catch|try)\b/.test(content) ||
        /[=<>!]=/.test(content) ||
        /\w+\s*\(.*\)/.test(content) ||
        /\w+\s*[=:]/.test(content);
};

const hasStructuralContent = (content: string): boolean => {
    return /\b(class|interface|function|export|import)\b/.test(content) ||
        /^\s*(public|private|protected|static)/.test(content);
};

const shouldSkipReview = (patchContext: any, filename: string): boolean => {
    // Skip pure formatting changes
    if (patchContext.isFormatting) {
        log.debug(`Skipping ${filename}: pure formatting changes`);
        return true;
    }

    // Skip very minor changes without logic
    if (patchContext.isMinorChange && !patchContext.hasLogicChanges) {
        log.debug(`Skipping ${filename}: minor change without logic changes`);
        return true;
    }

    // Skip generated files
    if (isGeneratedFile(filename)) {
        log.debug(`Skipping ${filename}: generated file`);
        return true;
    }

    return false;
};

const isGeneratedFile = (filename: string): boolean => {
    const generatedPatterns = [
        /\.lock$/,
        /package-lock\.json$/,
        /yarn\.lock$/,
        /\.min\.(js|css)$/,
        /\.d\.ts$/,
        /dist\/.*$/,
        /build\/.*$/,
        /\.generated\./,
    ];

    return generatedPatterns.some(pattern => pattern.test(filename));
};



const processFileReviews = async (changedFiles: any[], chat: Chat) => {
    const reviews = [];

    // First pass: analyze all patches to understand the overall change context
    const fileContexts = changedFiles.map(file => ({
        ...file,
        patchContext: analyzePatchContext(file.patch || '')
    }));

    // Filter out files that don't need review
    const filesToReview = fileContexts.filter(file => {
        if (file.status !== 'modified' && file.status !== 'added') {
            return false;
        }

        const patch = file.patch || '';
        if (!patch || patch.length > MAX_PATCH_COUNT) {
            log.info(`${file.filename} skipped: diff too large`);
            return false;
        }

        if (shouldSkipReview(file.patchContext, file.filename)) {
            return false;
        }

        return true;
    });

    log.info(`Reviewing ${filesToReview.length} out of ${changedFiles.length} changed files`);

    // Review only meaningful changes
    for (const file of filesToReview) {
        const patch = file.patch || '';

        try {
            log.debug(`Code review for ${file.filename}: ${file.patchContext.addedLines}+ ${file.patchContext.deletedLines}-`);

            // Enhanced review with patch context
            const res = await chat?.codeReview(patch, {
                filename: file.filename,
                context: file.patchContext,
                relatedFiles: filesToReview.map(f => f.filename)
            }) as { lgtm: boolean, review_comment: string };

            const lgtm = res.lgtm;
            const reviewComment = res.review_comment;

            // Only comment if there are actual issues
            if (!lgtm && reviewComment && reviewComment.trim() !== 'LGTM') {
                const formattedBody = formatReviewComment(lgtm, reviewComment);
                reviews.push({
                    path: file.filename,
                    body: formattedBody,
                });

                log.debug(`Review comment added for ${file.filename}`);
            } else {
                log.debug(`${file.filename}: LGTM - no comment needed`);
            }
        } catch (e) {
            log.error(`Review failed for ${file.filename}:`, e);
        }
    }

    return reviews;
};

const handlePullRequestReviewComment = async (context: any) => {
    const comment = context.payload.comment;
    const botName = 'compound-reviewer';

    // Only respond if bot is mentioned at the start
    if (!isBotMentioned(comment.body, botName)) {
        return;
    }

    // Get PR info
    const prNumber = context.payload.pull_request.number;
    const repo = context.repo();
    const chat = await loadChat(context);
    if (!chat) return;

    try {
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
        const userQuery = extractUserQuery(comment.body, botName);

        // Build context for the AI
        const prContext = buildPRContext(pullRequest, prDiff, reviewComments.data, parentComment);

        // Generate response using the chat system
        const response = await chat.respondToMention(userQuery, prContext);

        // Quote the original review comment
        const quoted = comment.body
            .split('\n')
            .map((line: string) => `> ${line}`)
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
    } catch (error) {
        log.error('Error handling review comment mention:', error);
    }
};

export const robot = (app: Probot) => {
    // Handle mentions in comments
    app.on('issue_comment.created', handleIssueComment);

    // Handle PR events
    app.on(
        ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
        handlePullRequestEvents
    );

    // Handle review comment mentions
    app.on('pull_request_review_comment.created', handlePullRequestReviewComment);
};