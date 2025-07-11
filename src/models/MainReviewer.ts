import { Groq } from 'groq-sdk';
import { ReviewFile, MainReviewResult, CodeChunk } from './ModelRouter.js';
import log from 'loglevel';

/**
 * Model 2: Main Reviewer (compound beta)
 * Performs detailed code review for code chunks
 */
export class MainReviewer {
  private groq: Groq;
  private model: string = 'compound-beta';
  private temperature = 0.7;
  private top_p = 1;
  private max_tokens = 800;

  constructor(groq: Groq) {
    this.groq = new Groq({
      apiKey: groq.apiKey,
      defaultHeaders: { 'groq-model-version': 'prerelease' }
    });
    if (process.env.GROQ_MODEL) this.model = process.env.GROQ_MODEL;
  }

  /**
   * Review a specific code chunk
   */
  public async reviewCodeChunk(
    file: ReviewFile,
    chunk: CodeChunk,
    allFiles: ReviewFile[]
  ): Promise<MainReviewResult | null> {
    log.debug(`🔬 Reviewing chunk lines ${chunk.lines.from}-${chunk.lines.to} in ${file.filename}`);
    const prompt = this.generateChunkReviewPrompt(file, chunk, allFiles);
    try {
      const response = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: this.model,
        temperature: this.temperature,
        top_p: this.top_p,
        max_tokens: this.max_tokens,
      });
      if (response.choices.length) {
        const content = response.choices[0].message.content || "";
        const result = this.parseReviewResponse(content, chunk.lines);
        if (result) {
          log.debug(`✅ Parsed review for ${file.filename}: lines=${result.lines.from}-${result.lines.to}, comment_length=${result.review_comment.length}`);
        } else {
          log.debug(`❌ Failed to parse review response for ${file.filename} chunk ${chunk.lines.from}-${chunk.lines.to}`);
        }
        return result;
      }
    } catch (error) {
      log.error(`💥 Error in main reviewer chunk for ${file.filename}:`, error);
    }
    return null;
  }

  private generateChunkReviewPrompt(file: ReviewFile, chunk: CodeChunk, allFiles: ReviewFile[]): string {
    const contextFiles = allFiles
      .filter(f => f.filename !== file.filename)
      .map(f => `File: ${f.filename}\n${f.patch}`)
      .join('\n\n');
    return `You are a senior code reviewer performing a focused review of a specific code chunk. Write your review as markdown with clear headers, line numbers, and actionable feedback. Do NOT return JSON.

**REVIEW FOCUS:**
${chunk.prompt}

**TARGET LINES:** ${chunk.lines.from}-${chunk.lines.to}

**FULL PR CONTEXT:**
${contextFiles ? contextFiles : 'No other files in this PR.'}

**FILE TO REVIEW:**
File: ${file.filename}
Status: ${file.status}
Changes:
${file.patch}

**REVIEW FORMAT:**
- Use markdown headers (### or ##) for each issue
- Start each section with the affected line numbers, e.g. "### Logic Error (Lines ${chunk.lines.from}-${chunk.lines.to})"
- Use bullet points for issues and suggestions
- Always provide code fixes in code blocks
- If you use a tool, include a block like:
  > **🔧 Tool Used:** code execution
  > **➡️ Input:** tested median([1,3,5])
  > **⬅️ Output:** returned 2.66 instead of 3
  > **💥 Impact:** incorrect median for odd arrays
- Be concise but thorough

**EXAMPLE OUTPUT:**
### Logic Error (Lines 10-15)
- Issue: Incorrect median calculation for odd-length arrays.
- Suggestion: Use Math.floor for index.
- Fix:
  \`\`\`javascript
  return sorted[Math.floor(sorted.length / 2)];
  \`\`\`
> **🔧 Tool Used:** code execution
> **➡️ Input:** tested median([1,3,5])
> **⬅️ Output:** returned 2.66 instead of 3
> **💥 Impact:** incorrect median for odd arrays

Focus only on lines ${chunk.lines.from}-${chunk.lines.to}. Do NOT return JSON. Only return markdown.`;
  }

  private parseReviewResponse(content: string, targetLines: { from: number; to: number }): MainReviewResult | null {
    // No JSON parsing, just return the markdown and lines
    if (typeof content === 'string' && content.trim().length > 0) {
      return {
        lines: targetLines,
        review_comment: content.trim()
      };
    }
    return null;
  }
}
