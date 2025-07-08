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
    const userPrompt = 'Please review the following code patch. Focus on potential bugs, risks, and improvement suggestions. Your review should be well-formatted and easy to read.';
    
    const jsonFormatRequirement = '\nProvide your feedback in a strict JSON format with the following structure:\n' +
        '{\n' +
        '  "lgtm": boolean, // true if the code looks good to merge, false if there are concerns\n' +
        '  "review_comment": string // Your detailed review comments. You should use markdown syntax in this string, but the overall response must be a valid JSON\n' +
        '}\n' +
        'Ensure your response is a valid JSON object.\n';

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
        const json = JSON.parse(res.choices[0].message.content || "");
        if (json.review_comment) {
          return json.review_comment;
        }
        return json;
      } catch (e) {
        return res.choices[0].message.content || "";
      }
    }
    return "";
  };
}
