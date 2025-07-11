import { Groq } from 'groq-sdk';
import { ReviewFile, MainReviewResult, FormattedReviewResult } from './ModelRouter.js';
import log from 'loglevel';

/**
 * Model 3: Output Formatter (llama scout)
 * Reformats and fixes output from the main reviewer
 */
export class OutputFormatter {
  private groq: Groq;
  private model = 'meta-llama/llama-4-scout-17b-16e-instruct';

  constructor(groq: Groq) {
    this.groq = groq;
  }

  /**
   * Format and fix review output for final presentation
   */
  public async formatReview(
    reviewResult: MainReviewResult,
    file: ReviewFile
  ): Promise<FormattedReviewResult> {
    const prompt = this.generateFormattingPrompt(reviewResult, file);
    
    try {
      const response = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: this.model,
        temperature: 0.2, // Low temperature for consistent formatting
        top_p: 0.9,
        max_tokens: 1500,
        response_format: {
          type: "json_object"
        },
      });

      if (response.choices.length) {
        const content = response.choices[0].message.content || "";
        const result = this.parseFormattedResponse(content, reviewResult);
        log.debug(`Formatted result for ${file.filename}: lgtm=${result.lgtm}`);
        return result;
      }
    } catch (error) {
      log.error(`Error in output formatter for ${file.filename}:`, error);
    }

    // Fallback: return a basic formatted result
    return this.createFallbackResult(reviewResult);
  }

  private generateFormattingPrompt(reviewResult: MainReviewResult, file: ReviewFile): string {
    return `You are a code review formatter responsible for the final output formatting and quality control. Your job is to take the main reviewer's output and ensure it's properly formatted and ready for GitHub.

**MAIN REVIEWER OUTPUT:**
Lines: ${JSON.stringify(reviewResult.lines)}
Review Comment:
${reviewResult.review_comment}

**FILE CONTEXT:**
File: ${file.filename}
Status: ${file.status}

**YOUR RESPONSIBILITIES:**
1. **Format Validation:** Ensure markdown is properly formatted
2. **Content Quality:** Fix any formatting errors, unclear language, or redundancy
3. **GitHub Compatibility:** Ensure output works well in GitHub PR reviews
4. **LGTM Decision:** Determine if issues found are blocking (lgtm: false) or just suggestions (lgtm: true)

**LGTM CRITERIA:**
- lgtm: true → Only suggestions, improvements, or minor issues (non-blocking)
- lgtm: false → Critical bugs, security issues, or significant problems that should block merge

**OUTPUT FORMAT:**
Return a JSON object with:
{
  "lgtm": boolean,
  "review_comment": "Cleaned and formatted markdown review",
  "lines": {"from": number, "to": number}
}

**FORMATTING RULES:**
- Use proper markdown headers (##, ###)
- Format code blocks with \`\`\`language
- Use bullet points for lists
- Bold important terms with **text**
- Keep tool verification sections intact
- Remove any redundant or unclear text
- Ensure code suggestions are properly formatted
- Make language clear and actionable

**Examples:**
{"lgtm": false, "review_comment": "## 🔒 Security Issue\\n\\nThe authentication bypass on line 23 needs immediate attention:\\n\\n\`\`\`javascript\\n// Current (vulnerable)\\nif (user.token) {\\n  // Missing validation\\n}\\n\\n// Fix\\nif (user.token && validateToken(user.token)) {\\n  // Properly validated\\n}\\n\`\`\`", "lines": {"from": 20, "to": 25}}

{"lgtm": true, "review_comment": "## 💡 Suggestions\\n\\n- Consider extracting the validation logic to a separate function for better reusability\\n- The error handling could be more specific on line 45\\n\\nOverall looks good!", "lines": {"from": 40, "to": 50}}`;
  }

  private parseFormattedResponse(content: string, originalResult: MainReviewResult): FormattedReviewResult {
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      }
      cleanContent = cleanContent.replace(/[\x00-\x1F\x7F]/g, '');
      
      const parsed = JSON.parse(cleanContent);
      
      return {
        lgtm: typeof parsed.lgtm === 'boolean' ? parsed.lgtm : false,
        review_comment: typeof parsed.review_comment === 'string' ? parsed.review_comment : originalResult.review_comment,
        lines: parsed.lines || originalResult.lines
      };
    } catch (error) {
      log.error('Error parsing formatted response:', error);
      return this.createFallbackResult(originalResult);
    }
  }

  private createFallbackResult(originalResult: MainReviewResult): FormattedReviewResult {
    // Simple heuristic: if the review mentions "critical", "security", "bug", "error", etc., mark as not LGTM
    const criticalKeywords = ['critical', 'security', 'bug', 'error', 'issue', 'problem', 'vulnerability', 'broken'];
    const hasIssues = criticalKeywords.some(keyword => 
      originalResult.review_comment.toLowerCase().includes(keyword)
    );

    return {
      lgtm: !hasIssues,
      review_comment: this.cleanMarkdown(originalResult.review_comment),
      lines: originalResult.lines
    };
  }

  private cleanMarkdown(content: string): string {
    // Basic markdown cleanup
    return content
      .replace(/\\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
