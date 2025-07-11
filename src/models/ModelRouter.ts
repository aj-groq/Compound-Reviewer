import { Groq } from 'groq-sdk';
import { FileFilter } from './FileFilter.js';
import { MainReviewer } from './MainReviewer.js';
import { OutputFormatter } from './OutputFormatter.js';
import log from 'loglevel';

export interface ReviewFile {
  filename: string;
  patch: string;
  status: string;
}

export interface FileReviewResult {
  lgtm: boolean;
  prompt: string;
}

export interface MainReviewResult {
  lines: { from: number; to: number };
  review_comment: string;
}

export interface FormattedReviewResult {
  lgtm: boolean;
  review_comment: string;
  lines?: { from: number; to: number };
}

export class ModelRouter {
  private groq: Groq;
  private fileFilter: FileFilter;
  private mainReviewer: MainReviewer;
  private outputFormatter: OutputFormatter;

  constructor(apiKey: string) {
    this.groq = new Groq({
      apiKey: apiKey,
      defaultHeaders: {
        'groq-model-version': 'prerelease'
      }
    });
    
    this.fileFilter = new FileFilter(this.groq);
    this.mainReviewer = new MainReviewer(this.groq);
    this.outputFormatter = new OutputFormatter(this.groq);
  }

  /**
   * Process a single file through the 3-model pipeline
   */
  public async reviewFile(file: ReviewFile, allFiles: ReviewFile[]): Promise<FormattedReviewResult | null> {
    try {
      log.debug(`Starting 3-model review for file: ${file.filename}`);

      // Step 1: File Filter (llama maverick) - determine if file needs review
      const filterResult = await this.fileFilter.shouldReview(file, allFiles);
      
      if (filterResult.lgtm) {
        log.debug(`File ${file.filename} marked as LGTM by filter, skipping further review`);
        return {
          lgtm: true,
          review_comment: "LGTM, nice work!"
        };
      }

      // Step 2: Main Reviewer (compound beta) - detailed review based on filter prompt
      const reviewResult = await this.mainReviewer.reviewCode(file, filterResult.prompt, allFiles);
      
      if (!reviewResult) {
        log.debug(`No review result from main reviewer for ${file.filename}`);
        return null;
      }

      // Step 3: Output Formatter (llama scout) - format and fix output
      const formattedResult = await this.outputFormatter.formatReview(reviewResult, file);
      
      log.debug(`Completed 3-model review for file: ${file.filename}`);
      return formattedResult;

    } catch (error) {
      log.error(`Error in 3-model review for file ${file.filename}:`, error);
      return null;
    }
  }

  /**
   * Process all files and return review results
   */
  public async reviewAllFiles(files: ReviewFile[]): Promise<FormattedReviewResult[]> {
    const results: FormattedReviewResult[] = [];
    
    for (const file of files) {
      const result = await this.reviewFile(file, files);
      if (result) {
        results.push(result);
      }
    }

    // If all files are LGTM, return a single encouraging comment
    if (results.length === 0 || results.every(r => r.lgtm)) {
      return [{
        lgtm: true,
        review_comment: "LGTM, nice work! All changes look good. 👍"
      }];
    }

    return results;
  }
}
