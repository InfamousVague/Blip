/**
 * Pagination — Simple arrow pagination with page indicator.
 */

import type { CSSProperties } from 'react';
import './Pagination.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  onPageChange: (page: number) => void;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

function ArrowLeft({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M5 12l7 7M5 12l7-7" />
    </svg>
  );
}

function ArrowRight({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M19 12l-7 7M19 12l-7-7" />
    </svg>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  size = 'sm',
  className = '',
  style,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <div className={`blip-pagination ${className}`} style={style}>
      <button
        className="blip-pagination__btn"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ArrowLeft size={iconSize} />
      </button>
      <span className="blip-pagination__info">
        {page} of {totalPages}
      </span>
      <button
        className={`blip-pagination__btn ${page < totalPages ? 'blip-pagination__btn--active' : ''}`}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ArrowRight size={iconSize} />
      </button>
    </div>
  );
}
