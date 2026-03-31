/**
 * SearchBar — Glass-styled search input with search icon and clear button.
 */

import type { CSSProperties, ChangeEvent } from 'react';
import './SearchBar.css';

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onClear?: () => void;
  className?: string;
  style?: CSSProperties;
}

const SEARCH_ICON = '<path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const BACKSPACE_ICON = '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m18 9-6 6M12 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

export function SearchBar({
  placeholder = 'Search...',
  value,
  onChange,
  onClear,
  className = '',
  style,
}: SearchBarProps) {
  return (
    <div className={`blip-search ${className}`} style={style}>
      <span
        className="blip-search__icon"
        dangerouslySetInnerHTML={{
          __html: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none">${SEARCH_ICON}</svg>`,
        }}
      />
      <input
        type="text"
        className="blip-search__input"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      {value && onClear && (
        <button
          className="blip-search__clear"
          onClick={onClear}
          aria-label="Clear search"
          dangerouslySetInnerHTML={{
            __html: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none">${BACKSPACE_ICON}</svg>`,
          }}
        />
      )}
    </div>
  );
}
