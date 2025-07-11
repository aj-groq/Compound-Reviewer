import { Groq } from 'groq-sdk';
import { ReviewFile, MainReviewResult, FormattedReviewResult } from './ModelRouter.js';
import log from 'loglevel';

/**
 * Model 3: Output Formatter (llama scout)
 * Reformats and consolidates structured findings into polished GitHub review comments
 */
export class OutputFormatter {
    private groq: Groq;
    private model = 'meta-llama/llama-4-scout-17b-16e-instruct';

    constructor(groq: Groq) {
        this.groq = groq;
    }

    /**
     * Format and consolidate review findings for final presentation
     * Accepts markdown review from MainReviewer, outputs strict JSON
     */
    public async formatReview(
        reviewResult: MainReviewResult,
        file: ReviewFile
    ): Promise<FormattedReviewResult> {
        log.debug(`✨ Model 3 (Scout) formatting: ${file.filename} - for lines ${reviewResult.lines.from}-${reviewResult.lines.to}`);
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
                max_tokens: 2000,
                response_format: {
                    type: "json_object"
                },
            });

            if (response.choices.length) {
                const content = response.choices[0].message.content || "";
                const result = this.parseFormattedResponse(content, reviewResult, file);
                log.debug(`🎨 Scout formatted ${file.filename}: lgtm=${result.lgtm}, final_comment_length=${result.review_comment.length}`);
                return result;
            }
        } catch (error) {
            log.error(`💥 Error in output formatter for ${file.filename}:`, error);

            // If it's a JSON validation error, try a simplified retry
            if (error instanceof Error && error.message && error.message.includes('json_validate_failed')) {
                try {
                    log.debug(`🔄 Retrying with simplified prompt for ${file.filename}`);
                    const simplifiedPrompt = `Convert this review to JSON:

Review: ${reviewResult.review_comment}

Return valid JSON only:
{"lgtm": false, "review_comment": "simplified review text", "lines": {"from": ${reviewResult.lines.from}, "to": ${reviewResult.lines.to}}}`;

                    const retryResponse = await this.groq.chat.completions.create({
                        messages: [{ role: 'user', content: simplifiedPrompt }],
                        model: this.model,
                        temperature: 0.1,
                        max_tokens: 1000,
                        response_format: { type: "json_object" }
                    });

                    if (retryResponse.choices.length) {
                        const retryContent = retryResponse.choices[0].message.content || "";
                        const retryResult = this.parseFormattedResponse(retryContent, reviewResult, file);
                        log.debug(`🎯 Retry successful for ${file.filename}`);
                        return retryResult;
                    }
                } catch (retryError) {
                    log.debug(`🚫 Retry failed for ${file.filename}, using fallback`);
                }
            }
        }

        // Fallback: return a basic formatted result
        log.debug(`⚠️ Using fallback formatting for ${file.filename}`);
        return this.createFallbackResult(reviewResult, file);
    }

    private generateFormattingPrompt(reviewResult: MainReviewResult, file: ReviewFile): string {
        return `Format this markdown review into clean JSON for GitHub.

**INPUT:**
${reviewResult.review_comment}

**FILE:** ${file.filename} (Lines ${reviewResult.lines.from}-${reviewResult.lines.to})

**RULES:**
- Keep it concise and focused - avoid verbose explanations
- Set lgtm: false for critical issues, logic errors, security problems
- Set lgtm: true for style suggestions, minor improvements
- Use clear, direct language without unnecessary detail
- Structure with simple headers and bullet points
- Escape quotes and newlines properly in JSON
- NO multi-line code blocks with triple quotes in review_comment
- Show complete fixed lines instead of separate "Issue" and "Suggestion"
- Group related issues under clear headings
- Make suggestions specific and actionable

- If you use a tool, include a block like:
  > **🔧 Tool Used:** code execution
  > **➡️ Input:** tested median([1,3,5])
  > **⬅️ Output:** returned 2.66 instead of 3
  > **💥 Impact:** incorrect median for odd arrays

**OUTPUT JSON (must be valid JSON):**
{
  "lgtm": boolean,
  "review_comment": "clean, readable markdown with proper JSON escaping and clear structure",
  "lines": {"from": ${reviewResult.lines.from}, "to": ${reviewResult.lines.to}}
}`;
    }

    private parseFormattedResponse(content: string, originalResult: MainReviewResult, file: ReviewFile): FormattedReviewResult {
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
                lines: parsed.lines || originalResult.lines,
                filename: file.filename
            };
        } catch (error) {
            log.error('Error parsing formatted response:', error);
            return this.createFallbackResult(originalResult, file);
        }
    }

    private createFallbackResult(originalResult: MainReviewResult, file: ReviewFile): FormattedReviewResult {
        // Simple heuristic: check if review comment contains critical indicators
        const commentLower = originalResult.review_comment.toLowerCase();
        const hasCriticalIssues = commentLower.includes('critical') ||
            commentLower.includes('security') ||
            commentLower.includes('error') ||
            commentLower.includes('🚨') ||
            commentLower.includes('⚠️');

        return {
            lgtm: !hasCriticalIssues,
            review_comment: originalResult.review_comment,
            lines: originalResult.lines,
            filename: file.filename
        };
    }
}
