"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Durchsuchbare Auswahlliste mit freier Eingabe.
 *
 * Ein natives `select` skaliert bei 66 Marken schlecht, und eine `datalist`
 * ist nicht erkennbar und je nach Browser unterschiedlich. Diese Umsetzung
 * folgt dem ARIA-Muster für Comboboxen: tippen filtert, Pfeiltasten
 * navigieren, Enter übernimmt, Escape bricht ab.
 */
export function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  emptyHint,
  allowCustom = true,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  hint?: string;
  /** Text, wenn die Suche nichts findet und freie Eingabe erlaubt ist */
  emptyHint?: string;
  allowCustom?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // Solange geschlossen, zeigt das Feld den gewählten Wert; beim Öffnen wird
  // daraus das Suchfeld.
  const display = open ? query : value;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!open) return options;
    if (!q) return options;
    const starts: string[] = [];
    const contains: string[] = [];
    for (const o of options) {
      const l = o.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [options, query, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      // Ein Klick daneben darf das Getippte nicht verschlucken — sonst
      // speichert ein Klick direkt auf «Speichern» den alten Wert.
      if (!wrapRef.current?.contains(e.target as Node)) commitText();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  });

  // Markierten Eintrag im Sichtbereich halten
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [active, open]);

  function openList() {
    if (disabled || open) return;
    setQuery("");
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }

  /** Schliesst die Liste ohne den getippten Text zu übernehmen. */
  function close() {
    setOpen(false);
    setQuery("");
  }

  /**
   * Übernimmt den getippten Text. Deckt er sich mit einem Eintrag, wird
   * dessen Schreibweise verwendet — sonst landen «bmw» und «BMW» als zwei
   * verschiedene Marken in der Datenbank.
   */
  function commitText() {
    const typed = query.trim();
    if (!typed) return close();
    const treffer = options.find((o) => o.toLowerCase() === typed.toLowerCase());
    if (treffer) return pick(treffer);
    if (allowCustom) onChange(typed);
    close();
  }

  function pick(option: string) {
    onChange(option);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(matches.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(matches.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (matches[active]) pick(matches[active]);
        else commitText();
        break;
      case "Escape":
        e.preventDefault();
        // Abbrechen heisst abbrechen: der getippte Text wird verworfen.
        close();
        break;
      case "Tab":
        // Tab bestätigt den markierten Treffer. Wer bewusst etwas Eigenes
        // eingibt, hat keinen Treffer in der Liste und behält seinen Text.
        if (query.trim() && matches[active]) pick(matches[active]);
        else commitText();
        break;
    }
  }

  return (
    <div className="block" ref={wrapRef}>
      <label
        htmlFor={`cb-${id}`}
        className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-3"
      >
        {label}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          id={`cb-${id}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`lb-${id}`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `opt-${id}-${active}` : undefined}
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={display}
          placeholder={open && value ? value : placeholder}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-line-strong bg-surface py-2 pl-3 pr-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-volt-ink disabled:opacity-60"
        />
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        {open && (
          <ul
            ref={listRef}
            id={`lb-${id}`}
            role="listbox"
            aria-label={label}
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-lg"
          >
            {matches.map((option, i) => {
              const isActive = i === active;
              return (
                <li
                  key={option}
                  id={`opt-${id}-${i}`}
                  role="option"
                  aria-selected={option === value}
                  data-active={isActive}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(option);
                  }}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${
                    isActive ? "bg-volt/30 text-ink" : "text-ink-2"
                  } ${option === value ? "font-semibold" : ""}`}
                >
                  {option}
                </li>
              );
            })}

            {matches.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-3">
                {allowCustom
                  ? (emptyHint ?? "Kein Treffer — deine Eingabe wird übernommen.")
                  : "Kein Treffer."}
              </li>
            )}
          </ul>
        )}
      </div>

      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
