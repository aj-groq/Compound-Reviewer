import { Groq } from 'groq-sdk';
import { ReviewFile, FileReviewResult } from './ModelRouter.js';
import log from 'loglevel';

/**
 * Model 1: File Filter (llama maverick)
 * Determines if files need review and creates focused prompts
 */
export class FileFilter {
  private groq: Groq;
  private model = 'meta-llama/llama-4-maverick-17b-128e-instruct';

  constructor(groq: Groq) {
    this.groq = groq;
  }

  /**
   * Determine if a file needs review and generate focused prompt
   */
  public async shouldReview(file: ReviewFile, allFiles: ReviewFile[]): Promise<FileReviewResult> {
    log.debug('============================================================================');
    log.debug(`🔍 Model 1 (Maverick) filtering: ${file.filename}`);
    log.debug('============================================================================');
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
        return result;
      }
    } catch (error) {
      log.error(`💥 Error in file filter for ${file.filename}:`, error);
    }

    // Fallback: assume file needs review
    log.debug(`⚠️ Fallback: ${file.filename} needs review (filter failed)`);
    return {
      lgtm: false,
      prompts: [{
        lines: { from: 1, to: 50 },
        prompt: `Review this file for potential issues, focusing on security, logic errors, and code quality.`
      }]
    };
  }

  private generateFilterPrompt(file: ReviewFile, allFiles: ReviewFile[]): string {
    const otherFiles = allFiles.filter(f => f.filename !== file.filename);
    const contextFiles = otherFiles.map(f => `File: ${f.filename}\n${f.patch}`).join('\n\n');

    return `Review this PR like a chill staff engineer. Focus on NEW changes only and think DRY.


**CONTEXT - All PR files for relationship understanding:**
${contextFiles ? contextFiles : 'No other files in this PR.'}

**TARGET FILE to analyze:**
File: ${file.filename}
Status: ${file.status}
Changes:
${file.patch}

ONLY bring up things if they're actually important - you don't need to comment on every category or find something to say. Quality over quantity.

PRIORITY ORDER:
- Critical bugs, security vulnerabilities, data corruption risks
- Logic errors that would cause incorrect behavior or crashes
- External API parameters and configurations that can't be verified at build time (e.g., invalid model names, incorrect endpoints, malformed request structures)
- Performance issues that would significantly impact users
- Missing error handling for operations that can fail

Remember: A later LLM reviewer will have access to code execution and web search capabilities to verify details, so focus on flagging potential issues rather than definitively proving them.

Be RUTHLESS about what matters. Only flag things that would actually break something or cause real problems. Skip style opinions, minor improvements, and defensive programming suggestions.

Think: "Would this cause a production incident or user-facing bug?" If not, let it slide.
FOCUS ON EXTERNAL INTEGRATIONS:
- Invalid configuration values that can't be verified at build time
- Incorrect external service endpoints or URLs
- Wrong parameter names or data structures for external APIs
- Missing required parameters for external service calls
- Invalid authentication or authorization formatting

ABSOLUTELY AVOID:
- Nitpicking error handling that's already reasonable
- Suggesting additional validation for edge cases that are already handled
- Commenting on isinstance() checks or similar defensive patterns
- Over-analyzing working code that handles expected scenarios
- Suggesting improvements to patterns that are industry standard
- Adding more checks "just to be safe" when existing checks are sufficient
- Flagging obvious syntax issues like missing variable interpolation in f-strings (e.g., f"Bearer api_key" instead of f"Bearer {api_key}")
- Pointing out basic Python/JavaScript syntax errors that would be caught immediately during development

**OUTPUT FORMAT:**
Return a JSON object with:
{
  "lgtm": boolean,
  "prompts": [
    {
      "lines": {"from": number, "to": number},
      "prompt": string
    }
  ]
}

If lgtm is true, set prompts to empty array [].
If lgtm is false, create an array of specific prompts for different code chunks:
- Each prompt should target a small, specific range (2-10 lines max)
- Focus on single issues per chunk (don't mix security + logic in one prompt)
- Be surgical and precise about problem locations
- Each chunk should address one specific concern

**Examples:**
{"lgtm": true, "prompts": []}
{"lgtm": false, "prompts": [
  {"lines": {"from": 3, "to": 3}, "prompt": "Check line 3 for hardcoded API key security issue"},
  {"lines": {"from": 17, "to": 20}, "prompt": "Review lines 17-20 for incorrect API endpoint usage"},
  {"lines": {"from": 23, "to": 25}, "prompt": "Validate error handling in lines 23-25"}
]}
{"lgtm": false, "prompts": [
  {"lines": {"from": 15, "to": 20}, "prompt": "Check median calculation logic in lines 15-20 for odd-length arrays"}
]}
`;
  }

  private parseFilterResponse(content: string): FileReviewResult {
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      }
      cleanContent = cleanContent.replace(/[\x00-\x1F\x7F]/g, '');
      
      const parsed = JSON.parse(cleanContent);
      log.debug(`🔍 Filter parsed result: lgtm=${parsed.lgtm}, prompts_count=${Array.isArray(parsed.prompts) ? parsed.prompts.length : 0}`);
      if (!parsed.lgtm && Array.isArray(parsed.prompts)) {
        parsed.prompts.forEach((prompt: any, index: number) => {
          log.debug(`  📍 Prompt ${index + 1}: lines ${prompt.lines?.from}-${prompt.lines?.to} - ${prompt.prompt?.substring(0, 50)}...`);
        });
      }
      return {
        lgtm: typeof parsed.lgtm === 'boolean' ? parsed.lgtm : false,
        prompts: Array.isArray(parsed.prompts) ? parsed.prompts : [{
          lines: { from: 1, to: 50 },
          prompt: 'Review this file for potential issues.'
        }]
      };
    } catch (error) {
      log.error('Error parsing filter response:', error);
      return {
        lgtm: false,
        prompts: [{
          lines: { from: 1, to: 50 },
          prompt: 'Review this file for potential issues.'
        }]
      };
    }
  }
}
