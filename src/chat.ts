import { Groq } from 'groq-sdk';

// Prepare for Groq integration
export class Chat {
    // Placeholder for Groq client
    private groq: any;
    private model: string;

    constructor(apikey: string) {
        this.groq = new Groq({
            apiKey: apikey,
            defaultHeaders: {
                'groq-model-version': 'prerelease'
            }
        });
        this.model = process.env.GROQ_MODEL || 'compound-beta';
    }

    private generatePrompt = (patch: string, context?: any) => {
        const contextInfo = context ? `
File: ${context.filename}
Change type: ${context.context.isRefactoring ? 'Refactoring' : 'New changes'}
Lines: +${context.context.addedLines} -${context.context.deletedLines}
Has logic changes: ${context.context.hasLogicChanges}
Related files: ${context.relatedFiles?.slice(0, 3).join(', ')}${context.relatedFiles?.length > 3 ? '...' : ''}
` : '';

        const userPrompt = `You are reviewing code changes as a senior engineer. Focus on NEW changes only. ${contextInfo}

REVIEW PHILOSOPHY:
- Only comment on actual issues that matter
- Don't comment on clean code changes that look fine
- If the code is correct and well-written, return LGTM
- Quality over quantity - prefer no comment over unnecessary noise

WHAT TO LOOK FOR (in order of priority):
1. **Critical Issues**: Bugs, security vulnerabilities, performance problems
2. **Logic Errors**: Incorrect algorithms, edge cases, null pointer issues  
3. **Code Quality**: Poor naming, unclear logic, missing error handling
4. **Architecture**: Violation of separation of concerns, patterns
5. **Tests**: Missing tests for new functionality (only if significant)

WHAT TO SKIP:
- Formatting and style issues (unless they harm readability)
- Minor refactoring suggestions that don't add value
- Nitpicking on personal preferences
- Comments on deletions unless they remove important logic
- Clean additions that look correct
- Error handling that is not needed

TOOLS AVAILABLE:
- **Code Execution**: Test logic, algorithms, and calculations with real examples to verify correctness. Use for testable logic (calculations, algorithms, data transformations, utility functions)
- **Web Search**: Verify API usage, best practices, and implementation patterns for external libraries and third-party APIs (only search for confirmed external APIs, not custom functions). Use for external APIs, third-party libraries, framework usage, or unfamiliar patterns

**When you find issues:**
- Show before/after code snippets with minimal context
- Use ellipses (...) to skip unchanged lines between the problematic and fixed code
- Be specific about what needs to be changed

Be concise and constructive. Think: "Would this comment help prevent a real problem or improve code quality meaningfully?"

Since this is a general file review (not line-specific), include relevant code snippets to make your feedback actionable. Make sure the review does not get too long.

Patch to review:
`;

        return `${userPrompt}${patch}`;
    };

    // Helper for the second model call
    private async reformatWithLlama(output: string): Promise<string | { lgtm: boolean, review_comment: string }> {
        const prompt = `You are a code review formatter. Given the following review output, reformat it into a valid JSON object with the following structure:

  Output format:
  Return a valid JSON string with the following structure:
  {
    "lgtm": true or false,
    "review_comment": "Your review in markdown, using only JSON-safe code formatting (no triple backticks) and structured with sections or bullet points when needed. When providing fixes, include the corrected code using single backticks or code blocks. If any tools were used during verification, include the tool usage information in the specified format."
  }

When you use tools, you must include the tool usage information in the specified format in the review_comment. If multiple tool calls were made for the same verification, only include the most relevant results without repetition. Only include tool results if they provide helpful insights or reveal issues - omit tool usage information if the output doesn't contribute meaningfully to the review or if the results are speculative (e.g., "likely", "seems to be", "appears to be").

> **🔧 Tool Used:** \`[tool name]\`  
> **➡️ Input:** \`[specific parameters/values without the code snippet OR exact search query used - include all inputs used]\`  
> **⬅️ Output:** \`[key findings/results]\`  
> **🎯 Impact:** \`[how this affects the review]\`

  Examples:
  {"lgtm": false, "review_comment": "## Issues Found\\n\\n- Fix potential null pointer in line 42: \`user?.name\`\\n\\n## Suggestions\\n\\n- Consider extracting validation logic to separate function"}
  {"lgtm": true, "review_comment": "Clean implementation with proper error handling and good separation of concerns. Nice work!"}
  {"lgtm": false, "review_comment": "## Issues Found\\n\\n- Logic error in median calculation for odd-length arrays\\n\\n > ### Used code execution to verify: tested with [1,3,5] and found incorrect averaging instead of returning middle element*\\n\\n## Suggestions\\n\\n- Fix line 15: change to \`return sorted_numbers[n // 2]\` for odd-length arrays ## Final Code\\n\\n\`\`\`python\\n<fixed code>\\n\`\`\`" }

If the input is already in this format, just clean up the markdown and formatting as needed. Ensure the output is valid JSON.

Input:
${output}`;
        const res = await this.groq.chat.completions.create({
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            temperature: +(process.env.temperature || 0) || 1,
            top_p: +(process.env.top_p || 0) || 1,
            max_tokens: process.env.max_tokens ? +process.env.max_tokens : undefined,
            response_format: {
                type: "json_object"
            },
        });
        if (res.choices.length) {
            try {
                let content = res.choices[0].message.content || "";
                content = content.trim();
                if (content.startsWith('```')) {
                    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
                }
                content = content.replace(/[\x00-\x1F\x7F]/g, '');
                const json = JSON.parse(content);
                const lgtm = typeof json.lgtm === 'boolean' ? json.lgtm : undefined;
                const review_comment = typeof json.review_comment === 'string' ? json.review_comment : '';
                return { lgtm, review_comment };
            } catch (e) {
                console.error('Error parsing JSON from llama:', e);
                return res.choices[0].message.content || "";
            }
        }
        return "";
    }

    public codeReview = async (patch: string, context?: any): Promise<string | { lgtm: boolean, review_comment: string }> => {
        if (!patch) {
            return "";
        }
        const prompt = this.generatePrompt(patch, context);
        // First call: main review model
        const res = await this.groq.chat.completions.create({
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            model: this.model,
            temperature: +(process.env.temperature || 0) || 1,
            top_p: +(process.env.top_p || 0) || 1,
            max_tokens: process.env.max_tokens ? +process.env.max_tokens : undefined,
        });
        let firstOutput = "";
        if (res.choices.length) {
            firstOutput = res.choices[0].message.content || "";
            firstOutput = firstOutput.trim();
            if (firstOutput.startsWith('```')) {
                firstOutput = firstOutput.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
            }
            firstOutput = firstOutput.replace(/[\x00-\x1F\x7F]/g, '');
        }
        // Add reasoning if available (for models that support it)
        if (res.choices[0].message.reasoning) {
            firstOutput += `\n\nModel\'s internal reasoning: ${res.choices[0].message.reasoning}`;
        }
        // Second call: reformat with Llama
        const reformatted = await this.reformatWithLlama(firstOutput);
        if (typeof reformatted === 'object' && reformatted !== null) {
            return reformatted;
        }
        // fallback: try to parse as JSON
        try {
            return JSON.parse(reformatted as string);
        } catch {
            return reformatted;
        }
    };

    public respondToMention = async (userQuery: string, prContext: any): Promise<string> => {
        if (!userQuery) {
            return "Hi! I'm Compound Reviewer. You can ask me questions about this PR or request specific code analysis.";
        }

        const conversationHistory = prContext.conversationHistory
            .map((comment: any) => `**${comment.author}**: ${comment.body}`)
            .join('\n\n');

        console.log('\n\nConversation History:\n##########################\n\n', conversationHistory,
            '\n\n##########################\n\n'
        );

        const prompt = `You are Compound Reviewer, a code review bot. A user has mentioned you in a PR comment with a question or request.

**User Query:** ${userQuery}
**PR Context:**
- **Title:** ${prContext.title}
- **Description:** ${prContext.description}
- **Author:** ${prContext.author}
- **Branch:** ${prContext.branch} → ${prContext.baseBranch}

**Recent Conversation:**
${conversationHistory}

**Code Changes:**
${prContext.diff}

Based on the information provided above, respond directly to the user's query. You can:
- Answer questions about the code changes
- Provide code analysis or suggestions
- Explain specific parts of the implementation
- Suggest improvements or alternatives
- Help with debugging issues

Respond naturally and directly without meta-commentary. Keep your response concise, helpful, and focused on the user's specific question. Use markdown formatting for code examples when appropriate.`;

        try {
            const res = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                model: this.model,
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
}
