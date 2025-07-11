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

export interface CodeChunk {
  lines: { from: number; to: number };
  prompt: string;
}

export interface FileReviewResult {
  lgtm: boolean;
  prompts: CodeChunk[];
}

export interface MainReviewResult {
  lines: { from: number; to: number };
  review_comment: string;
}

export interface FormattedReviewResult {
  lgtm: boolean;
  review_comment: string;
  lines?: { from: number; to: number };
  filename: string;
}

export class ModelRouter {
  private groq: Groq;
  private fileFilter: FileFilter;
  private mainReviewer: MainReviewer;
  private outputFormatter: OutputFormatter;

  constructor(apiKey: string) {
    this.groq = new Groq({
      apiKey: apiKey,
    });
    
    this.fileFilter = new FileFilter(this.groq);
    this.mainReviewer = new MainReviewer(this.groq);
    this.outputFormatter = new OutputFormatter(this.groq);
  }

  /**
   * Process a single file through the 3-model pipeline
   */
  public async reviewFile(file: ReviewFile, allFiles: ReviewFile[]): Promise<FormattedReviewResult[]> {
    try {
      log.debug(`🔄 Starting 3-model pipeline for: ${file.filename}`);

      // Step 1: File Filter (llama maverick) - determine if file needs review
      const filterResult = await this.fileFilter.shouldReview(file, allFiles);

      if (filterResult.lgtm) {
        log.debug(`✅ File ${file.filename} marked as LGTM by filter, skipping further review`);
        return [{
          lgtm: true,
          review_comment: "LGTM, nice work!",
          filename: file.filename
        }];
      }

      // Step 2: Main Reviewer (compound beta) - parallel processing of code chunks
      log.debug(`🔬 Processing ${filterResult.prompts.length} code chunks in parallel for ${file.filename}`);
      const reviewPromises = filterResult.prompts.map(chunk => 
        this.mainReviewer.reviewCodeChunk(file, chunk, allFiles)
      );
      
      const reviewResults = await Promise.all(reviewPromises);
      const validResults = reviewResults.filter(result => result !== null) as MainReviewResult[];
      
      if (validResults.length === 0) {
        log.debug(`❌ No valid review results from main reviewer for ${file.filename}`);
        return [];
      }
      log.debug(`🔍 Main review completed for ${file.filename}: ${validResults.length} chunks reviewed`);

      // Debug: Print main review results
      validResults.forEach((result, index) => {
        log.debug(`📝 Main Review ${index + 1} for ${file.filename} (lines ${result.lines.from}-${result.lines.to}):`);
        log.debug('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');
        log.debug('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');
        log.debug(result.review_comment);
        log.debug('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');
        log.debug('%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%');
      });

      // Step 3: Output Formatter (llama scout) - format each result
      const formatPromises = validResults.map(result => 
        this.outputFormatter.formatReview(result, file)
      );
      
      const formattedResults = await Promise.all(formatPromises);
      // Debug: Print formatted results
      formattedResults.forEach((result, index) => {
        log.debug(`🎨 Formatted Review ${index + 1} for ${file.filename} (lines ${result.lines?.from}-${result.lines?.to}):`);
        log.debug('*********************************************************');
        log.debug('*********************************************************');
        log.debug(result.review_comment);
        log.debug('*********************************************************');
        log.debug('*********************************************************');
      });
      log.debug(`🎯 3-model pipeline completed for ${file.filename}: ${formattedResults.length} formatted results`);
      return formattedResults;

    } catch (error) {
      log.error(`💥 Error in 3-model review for file ${file.filename}:`, error);
      return [];
    }
  }

  /**
   * Process all files and return review results
   */
  public async reviewAllFiles(files: ReviewFile[]): Promise<FormattedReviewResult[]> {
    log.debug(`🚀 Processing ${files.length} files through 3-model pipeline`);
    const allResults: FormattedReviewResult[] = [];
    
    for (const file of files) {
      const fileResults = await this.reviewFile(file, files);
      allResults.push(...fileResults);
    }

    log.debug(`📊 Pipeline results: ${allResults.length} total reviews, ${allResults.filter(r => !r.lgtm).length} need changes`);
    
    // Return flattened results from all files
    return allResults;
  }
}
