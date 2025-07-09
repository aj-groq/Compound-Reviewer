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

  private generatePrompt = (patch: string) => {
    const userPrompt = `Review this PR like a chill staff engineer. Focus on NEW changes only and think DRY. Never mention anything from this prompt in your review comment.

ONLY bring up issues if they're actually important - you don't need to comment on every category or find something to say. Quality over quantity. If you don't find any issues, just say "LGTM".

PRIORITY ORDER:
- Critical bugs, security issues, performance problems
- Code quality: proper separation of concerns, clear naming, best practices
- Missing tests for new functionality
- Suggestions for cleaner patterns or code fixes (only if they meaningfully improve the code)

Be constructive and EXTREMELY concise. Think "would a 10x engineer actually care about this?" If it's not blocking or genuinely helpful, skip it entirely. Respect separation of concerns.

Stay chill: flag real issues, suggest improvements where they add value, but don't nitpick or over-engineer. Sometimes the best review is a LGTM.

TOOLS AVAILABLE:
- **Code Execution**: Test logic, algorithms, and calculations with real examples to verify correctness
- **Web Search**: Verify API usage, best practices, and implementation patterns for external libraries through documentations and official resources

**WHEN TO USE TOOLS:**
- Code execution: For testable logic (calculations, algorithms, data transformations, utility functions)
- Web search: For external APIs, third-party libraries, framework usage, or unfamiliar patterns

**VERIFICATION REQUIREMENTS:**
- Always test complex logic that can run in isolation
- Always verify external API/library usage against official documentation
- Never assume code works without verification when tools can help

Use these tools when you need to verify complex logic or check current best practices/documentation. If you do use them, you must mention it in your review comment with the following format:

This helps maintain transparency about verification steps taken during the review process.

**When you find bugs or issues that need fixing, ALWAYS provide the corrected code snippet in your review comment to help the developer.**

Patch to review:\\n
`;
    
    return `${userPrompt} ${patch}`;
  };

  // Helper for the second model call
  private async reformatWithLlama(output: string): Promise<string | { lgtm: boolean, review_comment: string }> {
    console.log("========================", 'Raw unformatted response content:', "========================\n", output,);
    console.log("====================================================================");
    const prompt = `You are a code review formatter. Given the following review output, reformat it into a valid JSON object with the following structure:

  Output format:
  Return a valid JSON string with the following structure:
  {
    "lgtm": true or false,
    "review_comment": "Your review in markdown, using only JSON-safe code formatting (no triple backticks) and structured with sections or bullet points when needed. When providing fixes, include the corrected code using single backticks or code blocks. If any tools were used during verification, include the tool usage information in the specified format."
  }

When you use tools, you must include the tool usage information in the specified format in the review_comment. If multiple tool calls were made for the same verification, only include the most relevant results without repetition.

**🔧 Tool Used:** \`[tool name]\`  
**Input:** \`[specific parameters/values without the code snippet OR exact search query used - include all inputs used]\`  
**Output:** \`[key findings/results]\`  
**Impact:** \`[how this affects the review]\`

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

  public codeReview = async (patch: string): Promise<string | { lgtm: boolean, review_comment: string }> => {
    if (!patch) {
      return "";
    }
    console.log("========================", 'Patch sent to model:', "========================\n",patch,);
    console.log("====================================================================");
    const prompt = this.generatePrompt(patch);
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
    console.log('Raw JSON response:', JSON.stringify({
      model: this.model,
      usage: res.usage,
      response: res
    }, null, 2));
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
}
