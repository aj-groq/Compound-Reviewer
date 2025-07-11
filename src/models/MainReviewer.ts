import { Groq } from 'groq-sdk';
import { ReviewFile, MainReviewResult } from './ModelRouter.js';
import log from 'loglevel';

/**
 * Model 2: Main Reviewer (compound beta)
 * Performs detailed code review based on focused prompts from the filter
 */
export class MainReviewer {
  private groq: Groq;
  private model: string;

  constructor(groq: Groq) {
    this.groq = groq;
    this.model = process.env.GROQ_MODEL || 'compound-beta';
  }

  /**
   * Perform focused code review based on filter prompt
   */
  public async reviewCode(
    file: ReviewFile, 
    focusPrompt: string, 
    allFiles: ReviewFile[]
  ): Promise<MainReviewResult | null> {
    const prompt = this.generateReviewPrompt(file, focusPrompt, allFiles);
    
    try {
      const response = await this.groq.chat.completions.create({
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

      if (response.choices.length) {
        const content = response.choices[0].message.content || "";
        const result = this.parseReviewResponse(content, file);
        log.debug(`Review result for ${file.filename}: lines=${JSON.stringify(result?.lines)}, comment length=${result?.review_comment.length}`);
        return result;
      }
    } catch (error) {
      log.error(`Error in main reviewer for ${file.filename}:`, error);
    }

    return null;
  }

  private generateReviewPrompt(file: ReviewFile, focusPrompt: string, allFiles: ReviewFile[]): string {
    const contextFiles = allFiles
      .filter(f => f.filename !== file.filename)
      .map(f => `File: ${f.filename}\n${f.patch}`)
      .join('\n\n');

    return `You are a senior code reviewer performing a focused review. You have been specifically asked to focus on certain areas of this code.

**REVIEW FOCUS:**
${focusPrompt}

**FULL PR CONTEXT (for understanding relationships):**
${contextFiles ? contextFiles : 'No other files in this PR.'}

**FILE TO REVIEW:**
File: ${file.filename}
Status: ${file.status}
Changes:
${file.patch}

**REVIEW GUIDELINES:**
- Focus ONLY on what the filter prompt asks you to review
- Be thorough but concise
- Provide actionable feedback with specific line references
- Include code suggestions when fixing issues
- Use markdown formatting for clarity
- If you find critical issues, provide corrected code snippets

**TOOLS AVAILABLE:**
- **Code Execution**: Test logic, algorithms, and calculations with real examples to verify correctness
- **Web Search**: Verify API usage, best practices, and implementation patterns for external libraries

**WHEN TO USE TOOLS:**
- Code execution: For testable logic (calculations, algorithms, data transformations, utility functions)
- Web search: For external APIs, third-party libraries, framework usage, or unfamiliar patterns

**OUTPUT FORMAT:**
Return a JSON object with:
{
  "lines": {"from": number, "to": number},
  "review_comment": "Your markdown review comment with specific feedback, code suggestions, and tool verification when used"
}

The "lines" should indicate the specific range that needs attention (use the first problematic area if multiple issues exist).
The "review_comment" should be detailed markdown with actionable feedback.

If you use tools for verification, include this format in your review_comment:
> **🔧 Tool Used:** \`[tool name]\`  
> **➡️ Input:** \`[specific parameters/values]\`  
> **⬅️ Output:** \`[key findings/results]\`  
> **🎯 Impact:** \`[how this affects the review]\`

**Examples:**
{"lines": {"from": 15, "to": 25}, "review_comment": "## Security Issue\\n\\nThe authentication logic has a potential bypass. Consider adding proper validation:\\n\\n\`\`\`javascript\\nif (!user || !user.isAuthenticated()) {\\n  throw new Error('Unauthorized');\\n}\\n\`\`\`"}
{"lines": {"from": 45, "to": 67}, "review_comment": "## Logic Error\\n\\n> **🔧 Tool Used:** \`code execution\`\\n> **➡️ Input:** \`tested median calculation with [1,3,5]\`\\n> **⬅️ Output:** \`returned 2.66 instead of 3\`\\n> **🎯 Impact:** \`incorrect median for odd-length arrays\`\\n\\nFix the median calculation for odd-length arrays:\\n\\n\`\`\`javascript\\nreturn sorted[Math.floor(sorted.length / 2)];\\n\`\`\`"}`;
  }

  private parseReviewResponse(content: string, file: ReviewFile): MainReviewResult | null {
    try {
      // First try to parse as JSON
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
      }
      cleanContent = cleanContent.replace(/[\x00-\x1F\x7F]/g, '');
      
      const parsed = JSON.parse(cleanContent);
      
      if (parsed.lines && parsed.review_comment) {
        return {
          lines: {
            from: parsed.lines.from || 1,
            to: parsed.lines.to || parsed.lines.from || 1
          },
          review_comment: parsed.review_comment
        };
      }
    } catch (error) {
      log.debug('Content is not JSON, treating as markdown review:', error);
    }

    // Fallback: treat as markdown review and estimate line range from patch
    const lineRange = this.estimateLineRangeFromPatch(file.patch);
    return {
      lines: lineRange,
      review_comment: content
    };
  }

  private estimateLineRangeFromPatch(patch: string): { from: number; to: number } {
    const patchLines = patch.split('\n');
    let firstAddedLine = null;
    let lastAddedLine = null;
    let currentLine = 0;

    for (const line of patchLines) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          currentLine = parseInt(match[1], 10) - 1;
        }
        continue;
      }
      
      if (line.startsWith('---') || line.startsWith('+++')) continue;
      
      if (line.startsWith(' ') || line.startsWith('+')) {
        currentLine++;
        if (line.startsWith('+') && !line.startsWith('+++')) {
          if (firstAddedLine === null) firstAddedLine = currentLine;
          lastAddedLine = currentLine;
        }
      }
    }

    return {
      from: firstAddedLine || 1,
      to: lastAddedLine || firstAddedLine || 1
    };
  }
}
