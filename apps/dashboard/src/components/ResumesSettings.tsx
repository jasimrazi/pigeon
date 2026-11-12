import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ResumeSummary } from '@pigeon/shared';
import {
  FileText,
  Upload,
  Download,
  ExternalLink,
  Star,
  Trash2,
  Edit3,
  AlertTriangle,
  X,
  Loader2,
  Info,
  Archive,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from './ui/Button.js';

interface Props {
  apiBase?: string;
}

const TAG_REGEX = /^[a-z0-9+#._-]+$/;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function ResumesSettings({ apiBase = '' }: Props): React.JSX.Element {
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Upload Form State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete / Archive Modal State
  const [deleteModalResume, setDeleteModalResume] = useState<ResumeSummary | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Edit Modal State
  const [editingResume, setEditingResume] = useState<ResumeSummary | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Active resumes count (non-archived)
  const activeResumes = resumes.filter((r) => !r.archived);
  const isFirstResume = activeResumes.length === 0;

  // Auto-set default checkbox if first resume
  useEffect(() => {
    if (isFirstResume) {
      setIsDefault(true);
    }
  }, [isFirstResume]);

  const loadResumes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/api/resumes`);
      if (!res.ok) {
        throw new Error(`Failed to load resumes (${res.status})`);
      }
      const data = (await res.json()) as { resumes: ResumeSummary[] };
      setResumes(data.resumes || []);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load resumes',
      });
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadResumes();
  }, [loadResumes]);

  // Client-side file validation
  const handleValidateAndSelectFile = async (file: File) => {
    setUploadError(null);

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Only PDF documents are allowed.');
      return;
    }

    if (file.size === 0) {
      setUploadError('The selected file is empty (0 bytes).');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setUploadError('File size exceeds the 5 MB limit.');
      return;
    }

    // Magic bytes check (%PDF: 0x25, 0x50, 0x44, 0x46)
    try {
      const slice = file.slice(0, 4);
      const buffer = await slice.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (
        bytes.length < 4 ||
        bytes[0] !== 0x25 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x44 ||
        bytes[3] !== 0x46
      ) {
        setUploadError('Invalid PDF file: Missing %PDF signature bytes.');
        return;
      }
    } catch {
      setUploadError('Failed to inspect file contents.');
      return;
    }

    setSelectedFile(file);
    if (!label) {
      const cleanName = file.name.replace(/\.pdf$/i, '').trim();
      setLabel(cleanName.slice(0, 80));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleValidateAndSelectFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleValidateAndSelectFile(file);
    }
  };

  const handleAddTag = (
    input: string,
    currentTags: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    inputClearer: () => void,
  ) => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return;

    if (currentTags.length >= 10) {
      setUploadError('Maximum 10 tags allowed.');
      return;
    }

    if (!TAG_REGEX.test(trimmed)) {
      setUploadError('Tags may only contain lowercase letters, numbers, +, #, ., _, and -');
      return;
    }

    if (trimmed.length > 24) {
      setUploadError('Tags cannot exceed 24 characters.');
      return;
    }

    if (!currentTags.includes(trimmed)) {
      setter([...currentTags, trimmed]);
      setUploadError(null);
    }
    inputClearer();
  };

  const handleRemoveTag = (
    tagToRemove: string,
    currentTags: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter(currentTags.filter((t) => t !== tagToRemove));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setFeedback(null);

    if (!selectedFile) {
      setUploadError('Please choose a PDF file to upload.');
      return;
    }

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setUploadError('Resume label is required.');
      return;
    }

    if (trimmedLabel.length > 80) {
      setUploadError('Resume label cannot exceed 80 characters.');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('label', trimmedLabel);
      formData.append('tags', JSON.stringify(tags));
      formData.append('is_default', String(isFirstResume ? true : isDefault));

      const res = await fetch(`${apiBase}/api/resumes`, {
        method: 'POST',
        headers: {
          Origin: window.location.origin,
        },
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        error?: string;
      };

      if (!res.ok) {
        if (data.code === 'PAYLOAD_TOO_LARGE') {
          throw new Error('File size exceeds the 5 MB limit.');
        } else if (data.code === 'RESUME_LIMIT_REACHED') {
          throw new Error('Maximum limit of 20 resumes reached.');
        } else if (data.code === 'INVALID_PDF') {
          throw new Error('Only valid PDF documents are allowed.');
        } else {
          throw new Error(data.error || `Upload failed (${res.status})`);
        }
      }

      setFeedback({ type: 'success', message: `Resume "${trimmedLabel}" uploaded successfully.` });
      setSelectedFile(null);
      setLabel('');
      setTags([]);
      setTagInput('');
      setIsDefault(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await loadResumes();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSetDefault = async (resume: ResumeSummary) => {
    try {
      setFeedback(null);
      const res = await fetch(`${apiBase}/api/resumes/${resume.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ is_default: true }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || 'Failed to set default resume');
      }

      setFeedback({
        type: 'success',
        message: `"${resume.label}" is now your default resume.`,
      });
      await loadResumes();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Action failed',
      });
    }
  };

  const handleOpenEdit = (resume: ResumeSummary) => {
    setEditingResume(resume);
    setEditLabel(resume.label);
    setEditTags([...resume.tags]);
    setEditTagInput('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResume) return;

    const trimmedLabel = editLabel.trim();
    if (!trimmedLabel) {
      setFeedback({ type: 'error', message: 'Resume label is required.' });
      return;
    }

    try {
      setSavingEdit(true);
      const res = await fetch(`${apiBase}/api/resumes/${editingResume.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          label: trimmedLabel,
          tags: editTags,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || 'Failed to update resume');
      }

      setFeedback({ type: 'success', message: 'Resume details updated successfully.' });
      setEditingResume(null);
      await loadResumes();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Update failed',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModalResume) return;

    try {
      setDeleting(true);
      const res = await fetch(`${apiBase}/api/resumes/${deleteModalResume.id}`, {
        method: 'DELETE',
        headers: {
          Origin: window.location.origin,
        },
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        action?: string;
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to delete resume');
      }

      const msg =
        data.action === 'archived'
          ? `Resume "${deleteModalResume.label}" archived (preserved for history).`
          : `Resume "${deleteModalResume.label}" permanently deleted.`;

      setFeedback({ type: 'success', message: msg });
      setDeleteModalResume(null);
      await loadResumes();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Delete failed',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleReassignOpenApplications = async () => {
    if (!deleteModalResume || !reassignTargetId) return;

    try {
      setReassigning(true);
      const res = await fetch(`${apiBase}/api/resumes/${deleteModalResume.id}/reassign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ target_resume_id: reassignTargetId }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reassignedCount?: number;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reassign applications');
      }

      setFeedback({
        type: 'success',
        message: `Successfully reassigned ${data.reassignedCount ?? 0} application(s). Approved applications have been moved to draft for review.`,
      });
      await loadResumes();
      // Update deleteModalResume local state
      setDeleteModalResume((prev) =>
        prev ? { ...prev, usage: { ...prev.usage, open: 0 } } : null,
      );
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Reassign failed',
      });
    } finally {
      setReassigning(false);
    }
  };

  const displayedResumes = showArchived ? resumes : resumes.filter((r) => !r.archived);
  const otherActiveResumes = activeResumes.filter((r) => r.id !== deleteModalResume?.id);

  return (
    <div className="space-y-6">
      {/* Step 0 Tag Explanation & Safety Banner */}
      <div className="p-4 bg-surface-subtle border border-border rounded-[6px] flex items-start gap-3">
        <div className="p-1.5 rounded-[4px] bg-accent/10 text-accent shrink-0 mt-0.5">
          <Info size={16} />
        </div>
        <div className="text-[13px] text-fg-muted space-y-1">
          <p className="font-semibold text-fg">How Resume Selection Works</p>
          <p>
            Tags help Pigeon match the best resume to each job posting by comparing tags against the
            posting title and description. If tags match, the highest-scoring resume is picked. If
            no tags match or if there is a tie, Pigeon selects your default resume.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`p-3.5 rounded-[6px] text-[13px] font-medium border flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-state-success-bg border-state-success-border text-state-success-fg'
              : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 rounded-[4px] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            aria-label="Dismiss feedback"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Upload Card */}
      <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-fg-muted" />
            <h3 className="text-[14px] font-semibold text-fg">Upload PDF Resume</h3>
          </div>
          <span className="text-[12px] text-fg-muted">Max 5 MB • PDF only</span>
        </div>

        <form onSubmit={handleUpload} className="space-y-4">
          {/* Drag & Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-[6px] p-6 text-center transition-colors ${
              isDragging
                ? 'border-accent bg-accent/5'
                : selectedFile
                  ? 'border-border bg-surface-subtle'
                  : 'border-border hover:border-fg-muted'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              id="resume-file-picker"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="sr-only"
            />
            <div className="flex flex-col items-center gap-2">
              <FileText
                size={28}
                className={selectedFile ? 'text-accent' : 'text-fg-muted'}
                strokeWidth={1.5}
              />
              {selectedFile ? (
                <div>
                  <p className="text-[13px] font-semibold text-fg">{selectedFile.name}</p>
                  <p className="text-[12px] text-fg-muted">{formatBytes(selectedFile.size)}</p>
                </div>
              ) : (
                <div>
                  <p className="text-[13px] font-medium text-fg">
                    Drag and drop your PDF resume here, or
                  </p>
                  <label
                    htmlFor="resume-file-picker"
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-surface-subtle border border-border text-[13px] font-medium text-fg hover:bg-surface hover:border-fg-muted cursor-pointer transition-colors"
                  >
                    Choose PDF
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Form Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="resume-label-input"
                className="block text-[12px] font-medium text-fg-muted uppercase tracking-wider mb-1"
              >
                Resume Label <span className="text-state-danger-fg">*</span>
              </label>
              <input
                id="resume-label-input"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                placeholder="e.g. Senior Systems Engineer (2026)"
                className="w-full text-[13px] p-2 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="resume-tags-input"
                className="block text-[12px] font-medium text-fg-muted uppercase tracking-wider mb-1"
              >
                Target Tags (Max 10)
              </label>
              <div className="flex gap-2">
                <input
                  id="resume-tags-input"
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddTag(tagInput, tags, setTags, () => setTagInput(''));
                    }
                  }}
                  placeholder="e.g. systems, distributed, cloud"
                  className="flex-1 text-[13px] p-2 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAddTag(tagInput, tags, setTags, () => setTagInput(''))}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>

          {/* Tag Badges */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[12px] font-medium bg-surface-subtle border border-border text-fg"
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag, tags, setTags)}
                    className="p-0.5 hover:text-state-danger-fg cursor-pointer"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Make Default Checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              id="make-default-checkbox"
              type="checkbox"
              checked={isFirstResume ? true : isDefault}
              disabled={isFirstResume}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
            />
            <label htmlFor="make-default-checkbox" className="text-[13px] text-fg select-none">
              Make this the primary default resume
              {isFirstResume && ' (automatically default for your first resume)'}
            </label>
          </div>

          {uploadError && (
            <p className="text-[13px] text-state-danger-fg font-medium">{uploadError}</p>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={uploading}
              disabled={uploading || !selectedFile}
              icon={Upload}
            >
              {uploading ? 'Uploading...' : 'Upload Resume'}
            </Button>
          </div>
        </form>
      </div>

      {/* Resumes List Table */}
      <div className="bg-surface rounded-[6px] border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-fg-muted" />
            <h3 className="text-[14px] font-semibold text-fg">
              Uploaded Resumes ({activeResumes.length} / 20 active)
            </h3>
          </div>
          <div className="flex items-center gap-4">
            <label
              htmlFor="show-archived-checkbox"
              className="flex items-center gap-2 text-[12px] text-fg-muted cursor-pointer select-none"
            >
              <input
                id="show-archived-checkbox"
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent cursor-pointer"
              />
              <span>Show archived ({resumes.filter((r) => r.archived).length})</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              onClick={() => void loadResumes()}
              loading={loading}
              aria-label="Refresh resumes"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-fg-muted flex flex-col items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-[13px]">Loading resumes...</span>
          </div>
        ) : displayedResumes.length === 0 ? (
          <div className="p-12 text-center text-fg-muted space-y-2">
            <FileText size={32} className="mx-auto text-fg-muted/60" strokeWidth={1.5} />
            <p className="text-[14px] font-medium text-fg">No resumes uploaded yet.</p>
            <p className="text-[13px] text-fg-muted">
              Upload your first PDF resume above to enable application drafting and automated
              matching.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] divide-y divide-border">
              <thead className="bg-surface-subtle text-fg-muted uppercase text-[11px] font-semibold tracking-wider">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Resume Label
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Tags
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Size
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Uploaded
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Usage
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-fg">
                {displayedResumes.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-subtle/50 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-fg-muted shrink-0" />
                        <span className="truncate max-w-[200px]" title={r.label}>
                          {r.label}
                        </span>
                        {r.is_default && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30 rounded-[4px]">
                            Default
                          </span>
                        )}
                        {r.archived && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-surface-subtle text-fg-muted border border-border rounded-[4px] flex items-center gap-1">
                            <Archive size={10} />
                            Archived
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {r.tags.length > 0 ? (
                          r.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 text-[11px] rounded-[3px] bg-surface-subtle border border-border text-fg-muted"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-fg-muted text-[12px] italic">No tags</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                      {formatBytes(r.size_bytes)}
                    </td>
                    <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3 text-fg-muted whitespace-nowrap">
                      {r.usage ? `used in ${r.usage.open} open, ${r.usage.sent} sent` : 'unused'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {/* Preview */}
                        <a
                          href={`${apiBase}/api/resumes/${r.id}/download?disposition=inline`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-[4px] hover:bg-surface-subtle text-fg-muted hover:text-fg transition-colors"
                          title="Preview in new tab"
                          aria-label={`Preview ${r.label}`}
                        >
                          <ExternalLink size={14} />
                        </a>

                        {/* Download */}
                        <a
                          href={`${apiBase}/api/resumes/${r.id}/download`}
                          download
                          className="p-1.5 rounded-[4px] hover:bg-surface-subtle text-fg-muted hover:text-fg transition-colors"
                          title="Download PDF"
                          aria-label={`Download ${r.label}`}
                        >
                          <Download size={14} />
                        </a>

                        {/* Set Default */}
                        {!r.is_default && !r.archived && (
                          <button
                            type="button"
                            onClick={() => void handleSetDefault(r)}
                            className="p-1.5 rounded-[4px] hover:bg-surface-subtle text-fg-muted hover:text-accent transition-colors cursor-pointer"
                            title="Set as default resume"
                            aria-label={`Set ${r.label} as default`}
                          >
                            <Star size={14} />
                          </button>
                        )}

                        {/* Edit */}
                        {!r.archived && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(r)}
                            className="p-1.5 rounded-[4px] hover:bg-surface-subtle text-fg-muted hover:text-fg transition-colors cursor-pointer"
                            title="Edit label and tags"
                            aria-label={`Edit ${r.label}`}
                          >
                            <Edit3 size={14} />
                          </button>
                        )}

                        {/* Delete */}
                        {!r.archived && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteModalResume(r);
                              setReassignTargetId(otherActiveResumes[0]?.id || '');
                            }}
                            className="p-1.5 rounded-[4px] hover:bg-state-danger-bg/50 text-fg-muted hover:text-state-danger-fg transition-colors cursor-pointer"
                            title="Delete or archive"
                            aria-label={`Delete ${r.label}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Resume Modal */}
      {editingResume && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="bg-surface rounded-[6px] max-w-md w-full p-6 border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-[15px] font-semibold text-fg">Edit Resume Details</h3>
              <button
                type="button"
                onClick={() => setEditingResume(null)}
                className="p-1 rounded-[4px] hover:bg-surface-subtle text-fg-muted hover:text-fg"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label
                  htmlFor="edit-resume-label"
                  className="block text-[12px] font-medium text-fg-muted uppercase tracking-wider mb-1"
                >
                  Resume Label <span className="text-state-danger-fg">*</span>
                </label>
                <input
                  id="edit-resume-label"
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  maxLength={80}
                  className="w-full text-[13px] p-2 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-resume-tag-input"
                  className="block text-[12px] font-medium text-fg-muted uppercase tracking-wider mb-1"
                >
                  Tags (Max 10)
                </label>
                <div className="flex gap-2">
                  <input
                    id="edit-resume-tag-input"
                    type="text"
                    value={editTagInput}
                    onChange={(e) => setEditTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        handleAddTag(editTagInput, editTags, setEditTags, () =>
                          setEditTagInput(''),
                        );
                      }
                    }}
                    placeholder="e.g. backend, edge"
                    className="flex-1 text-[13px] p-2 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      handleAddTag(editTagInput, editTags, setEditTags, () => setEditTagInput(''))
                    }
                  >
                    Add
                  </Button>
                </div>
              </div>

              {editTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {editTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[12px] font-medium bg-surface-subtle border border-border text-fg"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag, editTags, setEditTags)}
                        className="p-0.5 hover:text-state-danger-fg cursor-pointer"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditingResume(null)}
                  disabled={savingEdit}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={savingEdit}
                  disabled={savingEdit}
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / Archive / Blocked Confirmation Dialog */}
      {deleteModalResume && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="bg-surface rounded-[6px] max-w-lg w-full p-6 border border-border shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-[4px] shrink-0 ${
                  deleteModalResume.is_default
                    ? 'bg-state-warning-bg text-state-warning-fg border border-state-warning-border'
                    : deleteModalResume.usage.open > 0
                      ? 'bg-state-warning-bg text-state-warning-fg border border-state-warning-border'
                      : 'bg-state-danger-bg text-state-danger-fg border border-state-danger-border'
                }`}
              >
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16px] font-semibold text-fg">
                  {deleteModalResume.is_default
                    ? 'Default Resume Cannot Be Deleted'
                    : deleteModalResume.usage.open > 0
                      ? 'Deletion Blocked: Resume Currently In Use'
                      : deleteModalResume.usage.sent > 0
                        ? 'Archive Resume'
                        : 'Permanently Delete Resume'}
                </h3>

                {/* Default Resume Guard */}
                {deleteModalResume.is_default ? (
                  <p className="mt-2 text-[14px] text-fg-muted leading-relaxed">
                    {activeResumes.length <= 1
                      ? 'The default resume cannot be deleted or archived while it is the only resume in your account.'
                      : 'Deleting the default resume while others exist is refused. Please set another resume as your default first.'}
                  </p>
                ) : deleteModalResume.usage.open > 0 ? (
                  /* Variant A: Blocked by open applications */
                  <div className="mt-2 space-y-3">
                    <p className="text-[14px] text-fg-muted leading-relaxed">
                      Cannot delete <strong className="text-fg">"{deleteModalResume.label}"</strong>{' '}
                      because it is referenced by{' '}
                      <strong className="text-fg">
                        {deleteModalResume.usage.open} open application(s)
                      </strong>{' '}
                      (draft or approved).
                    </p>

                    {otherActiveResumes.length > 0 ? (
                      <div className="p-3 bg-surface-subtle border border-border rounded-[6px] space-y-2">
                        <label
                          htmlFor="reassign-select"
                          className="block text-[12px] font-medium text-fg uppercase tracking-wider"
                        >
                          Reassign Open Applications To:
                        </label>
                        <select
                          id="reassign-select"
                          value={reassignTargetId}
                          onChange={(e) => setReassignTargetId(e.target.value)}
                          className="w-full text-[13px] p-2 rounded-[4px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {otherActiveResumes.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label} {r.is_default ? '(Default)' : ''}
                            </option>
                          ))}
                        </select>
                        <p className="text-[12px] text-fg-muted">
                          Note: Reassigning will automatically transition any approved applications
                          back to draft status so you can review them with the new resume.
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={reassigning}
                          disabled={reassigning || !reassignTargetId}
                          onClick={() => void handleReassignOpenApplications()}
                        >
                          Reassign Open Applications
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[13px] text-fg-muted">
                        No other active resumes exist to reassign applications to.
                      </p>
                    )}
                  </div>
                ) : deleteModalResume.usage.sent > 0 ? (
                  /* Variant B: Soft archive */
                  <p className="mt-2 text-[14px] text-fg-muted leading-relaxed">
                    This resume was used in{' '}
                    <strong className="text-fg">
                      {deleteModalResume.usage.sent} sent application(s)
                    </strong>
                    . It will be <strong className="text-fg">archived</strong> instead of
                    permanently deleted. Past sent records and download links will continue to work,
                    but this resume will no longer appear in selection queues.
                  </p>
                ) : (
                  /* Variant C: Permanent delete */
                  <p className="mt-2 text-[14px] text-fg-muted leading-relaxed">
                    This resume is not used by any applications. It will be{' '}
                    <strong className="text-fg">permanently removed</strong> from database and
                    storage. This action cannot be undone.
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDeleteModalResume(null)}
                disabled={deleting || reassigning}
              >
                Cancel
              </Button>

              {!deleteModalResume.is_default && deleteModalResume.usage.open === 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  loading={deleting}
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleteModalResume.usage.sent > 0 ? 'Archive Resume' : 'Permanently Delete'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
