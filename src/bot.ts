import { Context, Probot } from 'probot';
import { minimatch } from 'minimatch'

import { ModelRouter } from './models/ModelRouter.js';
import log from 'loglevel';
import { handlePullRequestReviewCommentCreated, handleIssueCommentCreated } from './handlers/commentMentions.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MAX_PATCH_COUNT = process.env.MAX_PATCH_LENGTH
    ? +process.env.MAX_PATCH_LENGTH
    : Infinity;



export const robot = (app: Probot) => {
    const loadModelRouter = async (context: Context): Promise<ModelRouter | null> => {
        if (GROQ_API_KEY) {
            return new ModelRouter(GROQ_API_KEY);
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

            return new ModelRouter(data.value);
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

    const calculateLineFromPatch = (patch: string, lines: { from: number; to: number }): {
        line: number;
        side: string;
        start_line?: number;
        start_side?: string
    } | null => {
        const patchLines = patch.split('\n');
        let currentRightLine = 0;
        let currentLeftLine = 0;
        
        // Track all lines that actually exist in the diff
        const validLines = new Set<string>(); // Format: "line:side"
        let inHunk = false;

        for (let i = 0; i < patchLines.length; i++) {
            const patchLine = patchLines[i];

            // Parse hunk header to get starting line numbers
            if (patchLine.startsWith('@@')) {
                const match = patchLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
                if (match) {
                    currentLeftLine = parseInt(match[1], 10) - 1;
                    currentRightLine = parseInt(match[2], 10) - 1;
                    inHunk = true;
                }
                continue;
            }

            // Skip file headers
            if (patchLine.startsWith('---') || patchLine.startsWith('+++')) continue;
            
            if (!inHunk) continue;

            // Track line numbers and record valid lines
            if (patchLine.startsWith(' ')) {
                // Context line - appears on both sides
                currentLeftLine++;
                currentRightLine++;
                validLines.add(`${currentRightLine}:RIGHT`);
                validLines.add(`${currentLeftLine}:LEFT`);
            } else if (patchLine.startsWith('-')) {
                // Deleted line - only on left side
                currentLeftLine++;
                validLines.add(`${currentLeftLine}:LEFT`);
            } else if (patchLine.startsWith('+')) {
                // Added line - only on right side
                currentRightLine++;
                validLines.add(`${currentRightLine}:RIGHT`);
            }
        }

        // Find the best line to comment on, preferring added/modified lines
        let bestLine = null;
        
        // Try to find a line within the specified range that exists in the diff
        for (let lineNum = lines.from; lineNum <= lines.to; lineNum++) {
            // Prefer RIGHT side (new code) over LEFT side (old code)
            if (validLines.has(`${lineNum}:RIGHT`)) {
                bestLine = { line: lineNum, side: 'RIGHT' };
                break;
            } else if (validLines.has(`${lineNum}:LEFT`)) {
                bestLine = { line: lineNum, side: 'LEFT' };
            }
        }
        
        // If no line in range found, try to find the closest valid line
        if (!bestLine) {
            // Look for any added line as fallback
            for (const validLineKey of validLines) {
                const [line, side] = validLineKey.split(':');
                if (side === 'RIGHT') {
                    bestLine = { line: parseInt(line), side: 'RIGHT' };
                    break;
                }
            }
        }

        if (!bestLine) {
            log.debug(`⚠️ No valid diff lines found for range ${lines.from}-${lines.to}`);
            return null;
        }

        log.debug(`✅ Found valid line ${bestLine.line} (${bestLine.side}) for range ${lines.from}-${lines.to}`);
        return bestLine;
    };


    app.on(
        ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
        async (context) => {
            const repo = context.repo();

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

            // Load the new 3-model router
            const modelRouter = await loadModelRouter(context);
            if (!modelRouter) {
                log.info('❌ ModelRouter initialization failed');
                return 'no model router';
            }
            log.info('🚀 Using 3-model pipeline for code review');
            // Prepare files for the 3-model pipeline
            const reviewFiles = changedFiles
                ?.filter(file => {
                    if (file.status !== 'modified' && file.status !== 'added') {
                        return false;
                    }
                    const patch = file.patch || '';
                    if (!patch || patch.length > MAX_PATCH_COUNT) {
                        log.info(`⏭️ ${file.filename} skipped (diff too large: ${patch.length} chars)`);
                        return false;
                    }
                    return true;
                })
                .map(file => ({
                    filename: file.filename,
                    patch: file.patch || '',
                    status: file.status
                })) || [];

            if (reviewFiles.length === 0) {
                log.info('📭 No files to review after filtering');
                return 'no files to review';
            }

            log.info(`📁 Processing ${reviewFiles.length} files: ${reviewFiles.map(f => f.filename).join(', ')}`);

            // Process all files through the 3-model pipeline
            const reviewResults = await modelRouter.reviewAllFiles(reviewFiles);
            log.debug("\n\n##########################################################################");
            log.info(`✅ 3-model pipeline completed: ${reviewResults.length} results, ${reviewResults.filter(r => !r.lgtm).length} need changes`);

            const reviews = [];
            let generalComments = [];

            // Process each file result and create inline comments
            for (let i = 0; i < reviewResults.length; i++) {
                const result = reviewResults[i];
                if (!result.review_comment || result.lgtm) {
                    continue; // Skip LGTM results for inline comments
                }

                // Find the corresponding file by filename from the review result
                const correspondingFile = reviewFiles.find(file => file.filename === result.filename) || reviewFiles[0];
                const lgtmStatus = result.lgtm ? '✅ LGTM' : '❌ Needs Changes';
                const formattedBody = `> ### ${lgtmStatus}\n\n${result.review_comment}`;

                // Calculate line and side for GitHub API
                let lineData = null;
                if (result.lines && correspondingFile) {
                    lineData = calculateLineFromPatch(correspondingFile.patch, result.lines);
                }

                if (lineData !== null) {
                    const reviewData: any = {
                        path: correspondingFile.filename,
                        body: formattedBody,
                        line: lineData.line,
                        side: lineData.side,
                    };

                    // Add multi-line parameters if present
                    if (lineData.start_line !== undefined) {
                        reviewData.start_line = lineData.start_line;
                        reviewData.start_side = lineData.start_side;
                        log.debug(`✅ Added multi-line comment for ${correspondingFile.filename} from line ${lineData.start_line} (${lineData.start_side}) to ${lineData.line} (${lineData.side})`);
                        log.debug(`Preview: ${formattedBody.replace(/\n/g, ' ').substring(0, 50)}...`);
                    } else {
                        log.debug(`✅ Added inline comment for ${correspondingFile.filename} at line ${lineData.line} (${lineData.side})`);
                        log.debug(`Preview: ${formattedBody.replace(/\n/g, ' ').substring(0, 50)}...`);
                    }

                    reviews.push(reviewData);
                } else if (result.lines && (result.lines.to - result.lines.from + 1) > 20 && result.lines.from === 1) {
                    // This is a general file review - add to overall review body instead of inline comment
                    log.debug(`📝 Adding general file review for ${correspondingFile.filename} (lines ${result.lines.from}-${result.lines.to})`);
                    generalComments.push({
                        filename: correspondingFile.filename,
                        comment: formattedBody
                    });
                } else {
                    log.debug(`⚠️ Could not determine line for ${correspondingFile.filename}, skipping inline comment`);
                }
            }
            try {
                // Determine review body based on results
                let reviewBody = "Code review by Compound Reviewer (3-Model Pipeline)";
                const hasIssues = reviewResults.some(r => !r.lgtm);

                if (!hasIssues && reviewResults.length > 0) {
                    reviewBody = "LGTM, nice work! 👍";
                } else if (reviews.length === 0 && generalComments.length === 0 && hasIssues) {
                    reviewBody = "Issues found but could not create inline comments. See logs for details.";
                } else {
                    const totalIssues = reviews.length + generalComments.length;
                    if (totalIssues > 0) {
                        reviewBody = `Found ${totalIssues} issue${totalIssues > 1 ? 's' : ''} that need${totalIssues === 1 ? 's' : ''} attention.`;
                    }

                    // Add general comments to review body
                    if (generalComments.length > 0) {
                        reviewBody += "\n\n## General File Reviews\n\n";
                        generalComments.forEach(gc => {
                            reviewBody += `### ${gc.filename}\n${gc.comment}\n\n`;
                        });
                    }
                }

                await context.octokit.pulls.createReview({
                    repo: repo.repo,
                    owner: repo.owner,
                    pull_number: context.pullRequest().pull_number,
                    body: reviewBody,
                    event: 'COMMENT',
                    commit_id: commits[commits.length - 1].sha,
                    comments: reviews,
                });
            } catch (e) {
                log.info(`💥 Failed to create review`, e);
            }

            console.timeEnd('total review time');
            log.info(
                'successfully reviewed',
                context.payload.pull_request.html_url
            );

            return 'success';
        }
    );

    app.on('pull_request_review_comment.created', handlePullRequestReviewCommentCreated);
    app.on('issue_comment.created', handleIssueCommentCreated);

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