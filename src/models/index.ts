/**
 * Modelos de datos para Share to LinkedIn
 */

export interface CodeSelectionContext {
  text: string;
  fileName: string;
  relativePath: string;
  fullPath: string;
  languageId: string;
  languageBadge: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

export interface GitFileChange {
  filePath: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface CommitContext {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  branch?: string;
  changedFiles: GitFileChange[];
  diffSummary?: string;
}

export interface PublicationOptions {
  includeFile: boolean;
  showLineNumbers: boolean;
  useCodeFormat: boolean;
  messageTemplate: string;
  userHeadline: string;
  aiEnabled: boolean;
  aiModelFamily: string;
}

export interface UserProfile {
  name: string;
  headline: string;
  avatarUrl?: string;
  authorUrn?: string;
  isConnected: boolean;
}

export type TemplateVariant = 'technical' | 'learning' | 'experience';

export interface ComposerState {
  activeTab: 'selection' | 'commit';
  selection?: CodeSelectionContext;
  commit?: CommitContext;
  recentCommits?: CommitContext[];
  selectedCommitHashes?: string[];
  selectedFiles?: string[];
  customContext?: string;
  includeImage: boolean;
  imageContentType: 'snippet' | 'diff' | 'custom';
  imageContentDescription?: string;
  postText: string;
  suggestedHashtags: string[];
  options: PublicationOptions;
  profile: UserProfile;
}

export interface LinkedInPublishResult {
  success: boolean;
  postUrn?: string;
  postUrl?: string;
  error?: string;
  isMock?: boolean;
}

