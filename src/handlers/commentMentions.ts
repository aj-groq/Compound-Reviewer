import log from 'loglevel';
import { Groq } from 'groq-sdk';
import { Context } from 'probot';


  const respondToMention = async (userQuery: string, prContext: any): Promise<string> => {
    if (!userQuery) {
      return "Hi! I'm Compound Reviewer. You can ask me questions about this PR or request specific code analysis.";
    }

    const conversationHistory = prContext.conversationHistory
      .map((comment: any) => `**${comment.author}**: ${comment.body}`)
      .join('\n\n');

    const parentCommentBlock = prContext.parentReviewComment
      ? `**Parent Review Comment:**\n${prContext.parentReviewComment.body}\n` : '';

    const prompt = `You are Compound Reviewer, a senior code review assistant. A user has mentioned you in a PR review comment with a question or request.

**User Query:** ${userQuery}
${parentCommentBlock}
**PR Context:**
- **Title:** ${prContext.title}
- **Description:** ${prContext.description}
- **Author:** ${prContext.author}
- **Branch:** ${prContext.branch} → ${prContext.baseBranch}

**Recent Conversation:**
${conversationHistory}

**Code Changes (diff):**
${prContext.diff}

---

**Instructions:**
- Answer questions about the code, PR content, implementation details, or technical concepts based on the actual code changes shown in the diff.
- Focus on what's actually in this PR - explain what the code does, how it works, why certain approaches were taken, or provide context about the changes.
- For code-related questions: reference specific lines, functions, or patterns from the diff above.
- For conceptual questions: explain the underlying logic, architecture, or design decisions visible in the changes.
- For debugging help: analyze the actual code in the diff and suggest fixes or improvements.
- If the question is about external APIs, services, or setup that's not visible in the code changes, use web search to find current documentation and provide accurate setup instructions.
- If relevant, include code examples or suggestions in markdown.
- Do not include meta-commentary or apologies. Be direct and helpful.
- Keep your response concise and focused on the user's specific question.
- **KEEP IT SHORT**: Respond with 50 words or less unless absolutely required for technical accuracy or detailed explanations. Be brief and to the point.

**TOOLS AVAILABLE:**
- **Code Execution**: Run code snippets to demonstrate functionality, test examples, or validate logic
- **Web Search**: Look up documentation, API references, best practices, or clarify technical concepts when the answer isn't in the code changes

**WHEN TO USE TOOLS:**
- Code execution: When you need to show how code works, demonstrate examples, or validate user's understanding
- Web search: When the question is about external services, APIs, setup instructions, or documentation that's not visible in the PR changes

Use these tools when you need to verify complex logic or provide accurate setup/configuration information that goes beyond what's shown in the code changes.
`;

    try {
      const groq = new Groq({
        apiKey: process.env.GROQ_API_KEY,
        defaultHeaders: {
          'groq-model-version': 'prerelease'
        }
      });
      const model = process.env.GROQ_MODEL || 'compound-beta';
      
      const res = await groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: model,
        temperature: +(process.env.temperature || 0) || 0.7,
        top_p: +(process.env.top_p || 0) || 1,
        max_tokens: process.env.max_tokens ? +process.env.max_tokens : 1000,
      });

      if (res.choices.length) {
        return res.choices[0].message.content || "I'm sorry, I couldn't generate a response. Please try again.";
      }
    } catch (error) {
      console.error('Error in respondToMention:', error);
      return "I encountered an error while processing your request. Please try again later.";
    }

    return "I'm sorry, I couldn't generate a response. Please try again.";
  };

export async function handlePullRequestReviewCommentCreated(context: Context) {
  // Type guard: ensure payload has comment and pull_request
  if (!('comment' in context.payload) || !('pull_request' in context.payload)) {
    return;
  }
  const comment = (context.payload as any).comment;
  const botName = 'compound-reviewer';

  // Only respond if bot is mentioned at the start
  const firstWord = comment.body.trim().split(/\s+/)[0];
  if (firstWord !== `@${botName}` && firstWord !== botName) {
    return;
  }

  // Get PR info
  const prNumber = context.payload.pull_request.number;
  const repo = context.repo();
  
  // Check for GROQ API key
  if (!process.env.GROQ_API_KEY) {
    await context.octokit.issues.createComment({
      repo: repo.repo,
      owner: repo.owner,
      issue_number: prNumber,
      body: `Seems you are using me but didn't get GROQ_API_KEY set in Variables/Secrets for this repo.`,
    });
    return;
  }

  log.debug('Bot mentioned in review comment, processing request', {
    prNumber,
    userQuery: comment.body.replace(new RegExp(`@${botName}`, 'gi'), '').replace(new RegExp(botName, 'gi'), '').trim(),
    hasParentComment: !!comment.in_reply_to_id
  });

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
    conversationHistory: reviewComments.data.slice(-5).map((c: any) => ({
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
  const response = await respondToMention(userQuery, prContext);

  log.debug('Generated response for review comment mention', {
    responseLength: response.length,
    willQuoteOriginal: true,
    prNumber
  });

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
}

export async function handleIssueCommentCreated(context: Context) {
  // Type guard: ensure payload has comment and issue
  if (!('comment' in context.payload) || !('issue' in context.payload)) {
    return;
  }
  const comment = (context.payload as any).comment;
  const issue = (context.payload as any).issue;
  const botName = 'compound-reviewer';
  
  log.debug('Received issue_comment.created event', {
    commentId: comment.id,
    commentBody: comment.body,
    author: comment.user?.login,
    issueNumber: issue?.number,
    isPullRequest: !!issue?.pull_request
  });
  
  // Check if the bot is mentioned at the start of the comment
  const firstWord = comment.body.trim().split(/\s+/)[0];
  
  if (firstWord !== `@${botName}` && firstWord !== botName) {
    log.debug('Bot not mentioned at start of comment, skipping');
    return;
  }

  log.debug('Bot mentioned in comment');

  // Only respond to PR comments
  if (!issue?.pull_request) {
    log.debug('Comment is not on a pull request, skipping');
    return;
  }

  log.debug('Comment is on a pull request, proceeding');

  const repo = context.repo();
  log.debug('Repository info', { owner: repo.owner, repo: repo.repo });

  // Check for GROQ API key
  if (!process.env.GROQ_API_KEY) {
    log.info('GROQ_API_KEY not found for mention response');
    await context.octokit.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issue.number,
      body: 'Seems you are using me but didn\'t get GROQ_API_KEY set in Variables/Secrets for this repo.',
    });
    return;
  }

  log.debug('Comment body:', comment.body);
  log.debug('Bot name:', botName);
  log.debug('Is pull request:', !!issue?.pull_request);
  log.debug('Issue number:', issue?.number);
  log.debug('Repository:', { owner: repo.owner, repo: repo.repo });

  try {
    // Get PR information
    const prNumber = issue.number;
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
      conversationHistory: comments.data.slice(-5).map((c: any) => ({
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

    // Generate response using direct Groq call
    log.debug('Generating response using respondToMention');
    const response = await respondToMention(userQuery, prContext);

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
      issue_number: issue.number,
      body: 'Sorry, I encountered an error while processing your request. Please try again later.',
    });
  }
} 
