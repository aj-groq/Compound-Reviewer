import { Groq } from 'groq-sdk';

// Prepare for Groq integration
export class Chat {
  // Placeholder for Groq client
  private groq: any;
  private model: string;

  constructor(apikey: string) {
    this.groq = new Groq({
      apiKey: apikey,
    });
    this.model = process.env.GROQ_MODEL || 'compound-beta';
  }

  private generatePrompt = (patch: string) => {
    const userPrompt = `Review this PR like a chill staff engineer. Focus on NEW changes only and think DRY.

ONLY bring up things if they're actually important - you don't need to comment on every category or find something to say. Quality over quantity.

PRIORITY ORDER:
- Critical bugs, security issues, performance problems
- Code quality: proper separation of concerns, clear naming, best practices
- Missing tests for new functionality
- Suggestions for cleaner patterns or code fixes (only if they meaningfully improve the code)

Be constructive and EXTREMELY concise. Think "would a 10x engineer actually care about this?" If it's not blocking or genuinely helpful, skip it entirely. Respect separation of concerns.

Stay chill: flag real issues, suggest improvements where they add value, but don't nitpick or over-engineer. Sometimes the best review is a LGTM.

TOOLS AVAILABLE:
- You MUST execute code snippets to test logic and verify if implementations actually work - USE THIS EXTENSIVELY for any non-trivial logic
- You can search documentation and official resources for API usage, best practices, and implementation patterns

**CRITICAL: When reviewing code with calculations, algorithms, or complex logic, ALWAYS use code execution to verify correctness. Don't just assume code works - test it with real examples.**

Use these tools when you need to verify complex logic or check current best practices/documentation. If you do use them, you must mention it in your review comment with the following format:

> **🔧 Tool Used:** \`[tool name]\`  
> **Input:** \`[what you tested/searched]\`  
> **Output:** \`[key findings/results]\`  
> **Impact:** \`[how this affects the review]\`

This helps maintain transparency about verification steps taken during the review process.

**When you find bugs or issues that need fixing, ALWAYS provide the corrected code snippet in your review comment to help the developer.**

Output format:
Return a valid JSON string with the following structure:
{
  "lgtm": true or false,
  "review_comment": "Your review in markdown, using only JSON-safe code formatting (no triple backticks) and structured with sections or bullet points when needed. When providing fixes, include the corrected code using single backticks or code blocks."
}

Examples:
{"lgtm": false, "review_comment": "## Issues Found\\n\\n- Fix potential null pointer in line 42: \`user?.name\`\\n\\n## Suggestions\\n\\n- Consider extracting validation logic to separate function"}
{"lgtm": true, "review_comment": "Clean implementation with proper error handling and good separation of concerns. Nice work!"}
{"lgtm": false, "review_comment": "## Issues Found\\n\\n- Logic error in median calculation for odd-length arrays\\n\\n > ### Used code execution to verify: tested with [1,3,5] and found incorrect averaging instead of returning middle element*\\n\\n## Suggestions\\n\\n- Fix line 15: change to \`return sorted_numbers[n // 2]\` for odd-length arrays ### Final Code\\n\\n\`\`\`python\\n<fixed code>\\n\`\`\`" }

Patch to review:\\n
`;
    
    return `${userPrompt} ${patch}`;
  };

  public codeReview = async (patch: string): Promise<string | { lgtm: boolean, review_comment: string }> => {
    if (!patch) {
      return "";
    }
        console.log("========================", 'Patch sent to model:\n', patch, "\n========================");
    console.log("=====================================================================================");
    const prompt = this.generatePrompt(patch);
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
      response_format: {
        type: "json_object"
      },
    });
     console.log('Raw JSON response:', JSON.stringify({
      model: this.model,
      usage: res.usage,
      response: res
    }, null, 2));
    if (res.choices.length) {
      try {
        let content = res.choices[0].message.content || "";

        // Remove wrapping triple backticks and optional language specifier
        content = content.trim();
        if (content.startsWith('```')) {
          content = content.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
        }
        
        // Clean up any control characters that might cause JSON parsing issues
        content = content.replace(/[\x00-\x1F\x7F]/g, '');
        
        const json = JSON.parse(content);
        
        // Extract lgtm and review_comment from the parsed JSON
        const lgtm = typeof json.lgtm === 'boolean' ? json.lgtm : undefined;
        const review_comment = typeof json.review_comment === 'string' ? json.review_comment : '';
        console.log('lgtm:', lgtm);
        console.log('review_comment:', review_comment);
        return {
          lgtm,
          review_comment
        };

      } catch (e) {
        console.error('Error parsing JSON:', e);
        return res.choices[0].message.content || "";
      }
    }
    return "";
  };
}
