import { Groq } from 'groq-sdk';
import { ReviewFile, FileReviewResult } from './ModelRouter.js';
import log from 'loglevel';

/**
 * Model 1: File Filter (llama maverick)
 * Determines if files need review and creates focused prompts
 */
export class FileFilter {
  private groq: Groq;
  private model = 'meta-llama/llama-4-maverick-17b-16e-instruct';

  constructor(groq: Groq) {
    this.groq = groq;
  }

  /**
   * Determine if a file needs review and generate focused prompt
   */
  public async shouldReview(file: ReviewFile, allFiles: ReviewFile[]): Promise<FileReviewResult> {
    const prompt = this.generateFilterPrompt(file, allFiles);
    
    try {
      const response = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: this.model,
        temperature: 0.1, // Low temperature for consistent filtering
        top_p: 0.9,
        max_tokens: 500,
        response_format: {
          type: "json_object"
        },
      });

      if (response.choices.length) {
        const content = response.choices[0].message.content || "";
        const result = this.parseFilterResponse(content);
        log.debug(`Filter result for ${file.filename}: lgtm=${result.lgtm}, prompt="${result.prompt.substring(0, 100)}..."`);
        return result;
      }
    } catch (error) {
      log.error(`Error in file filter for ${file.filename}:`, error);
    }

    // Fallback: assume file needs review
    return {
      lgtm: false,
      prompt: `Review this file for potential issues, focusing on security, logic errors, and code quality.`
    };
  }

  private generateFilterPrompt(file: ReviewFile, allFiles: ReviewFile[]): string {
    const otherFiles = allFiles.filter(f => f.filename !== file.filename);
    const contextFiles = otherFiles.map(f => `File: ${f.filename}\n${f.patch}`).join('\n\n');

    return `You are a senior code reviewer analyzing if files need detailed review. Your job is to filter out trivial changes and focus review attention on meaningful changes.

**CONTEXT - All PR files for relationship understanding:**
${contextFiles ? contextFiles : 'No other files in this PR.'}

**TARGET FILE to analyze:**
File: ${file.filename}
Status: ${file.status}
Changes:
${file.patch}

**ANALYSIS CRITERIA:**
Skip review (lgtm: true) for:
- Pure formatting/whitespace changes
- Simple typo fixes in comments or strings
- Adding/removing empty lines
- Basic import reordering
- Simple variable renames without logic changes
- Generated code changes (package-lock.json, etc.)
- Documentation updates without code changes

Require review (lgtm: false) for:
- New logic or algorithm changes
- Security-related modifications (auth, validation, permissions)
- API changes or new endpoints
- Database schema changes
- Error handling modifications
- Performance-critical code changes
- Complex refactoring
- New dependencies or library usage

**OUTPUT FORMAT:**
Return a JSON object with:
{
  "lgtm": boolean,
  "prompt": string
}

If lgtm is true, set prompt to empty string "".
If lgtm is false, create a specific prompt for the main reviewer focusing on:
- Specific line ranges that need attention (e.g., "check lines 15-25 for security")
- What type of review is needed (security, logic, performance, etc.)
- Key concerns based on the changes

**Examples:**
{"lgtm": true, "prompt": ""}
{"lgtm": false, "prompt": "Check lines 45-67 for security issues in the new authentication logic. Review error handling in lines 82-95."}
{"lgtm": false, "prompt": "Review the new API endpoint implementation in lines 23-56 for proper validation and error responses."}`;
  }

  private parseFilterResponse(content: string): FileReviewResult {
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      }
      cleanContent = cleanContent.replace(/[\x00-\x1F\x7F]/g, '');
      
      const parsed = JSON.parse(cleanContent);
      
      return {
        lgtm: typeof parsed.lgtm === 'boolean' ? parsed.lgtm : false,
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : 'Review this file for potential issues.'
      };
    } catch (error) {
      log.error('Error parsing filter response:', error);
      return {
        lgtm: false,
        prompt: 'Review this file for potential issues.'
      };
    }
  }
}
