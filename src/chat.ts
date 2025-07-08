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
    const userPrompt = `You are a code review assistant. Review the following code patch with a practical, objective approach.\n\nInstructions:\n- If the patch is functionally correct and has no significant bugs, security issues, or major problems, mark it as LGTM. Minor style or optimization suggestions can be included in LGTM reviews.\n- If you find any real bugs, security vulnerabilities, or significant architectural issues, do NOT mark as LGTM. Always provide a specific code suggestion for each issue, using single backticks for inline code or indentation for multi-line code (do NOT use triple backticks).\n- ALWAYS structure your review using sections (e.g., ## Issues Found, ## Suggestions, ## Good Practices) or bullet points. NEVER write plain paragraphs or chunks of text without structure.\n- Use sections only if there are actual points to mention. You may add other relevant sections if needed.\n- Do NOT include unnecessary sections, repeated information, general praise, or filler content.\n- If you suggest code changes, present them in a JSON-safe way (no triple backticks).\n- Keep the review concise and focused on actionable feedback.\n\nOutput format:\nReturn a valid JSON string with the following structure:\n{\n  "lgtm": true or false,\n  "review_comment": "Your review in markdown, using only JSON-safe code formatting (no triple backticks) and ALWAYS structured with sections or bullet points."\n}\n\nExample:\n{"lgtm": true, "review_comment": "## Review Summary\\n\\n- The patch is functionally correct\\n- No security issues found"}\n\nPatch to review:\n`;
    
    const jsonFormatRequirement = 'Please provide your feedback in the following JSON format with lgtm as a boolean and review_comment as a markdown string:\n' +
'Example (lgtm depends on the code review and the review comment structure is flexible and can be adapted as needed):\n' +
'{"lgtm": true, "review_comment": "The actual review comment in markdown format with sections when appropriate"}\n' +
'Your response must be a valid JSON string with the above structure. Both "lgtm" and "review_comment" fields are required and must be present in your response. The value for review_comment must be a single, properly quoted Markdown string (not a JS object, not a list, not raw Markdown). Do not have ```json or ``` in your response. Do not return a JS object or a list. Only return a valid JSON string.';

    return `${userPrompt}${jsonFormatRequirement}:
    ${patch}
    `;
  };

  public codeReview = async (patch: string): Promise<string | { lgtm: boolean, review_comment: string }> => {
    if (!patch) {
      return "";
    }
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
    if (res.choices.length) {
      try {
        let content = res.choices[0].message.content || "";
        console.log('Raw response content:', content);
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
