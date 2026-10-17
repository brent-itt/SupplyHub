"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { StudentFormItem } from "@/lib/student-stock-out";

function itemLabel(item: StudentFormItem) {
  return `${item.name} · ${item.sku} (${item.unit})`;
}

export function StudentItemPicker({ items, disabled }: { items: StudentFormItem[]; disabled: boolean }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = items.find(item => item.id === selectedId);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = selected && query === itemLabel(selected) ? items : items.filter(item => {
    const text = `${item.name} ${item.sku} ${item.unit}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  const expanded = open && !disabled;
  const activeItem = matches[activeIndex];

  useEffect(() => {
    inputRef.current?.setCustomValidity(query && !selected ? "Choose an item from the search results." : "");
  }, [query, selected]);

  useEffect(() => {
    if (expanded && activeItem) document.getElementById(`${id}-option-${activeItem.id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeItem, expanded, id]);

  function choose(item: StudentFormItem) {
    if (disabled) return;
    setSelectedId(item.id);
    setQuery(itemLabel(item));
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.setCustomValidity("");
    inputRef.current?.focus();
  }

  return <div className="sys-field student-item-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id}>What item are you collecting?</label>
    <input type="hidden" name="item_id" value={selected?.id ?? ""} disabled={disabled}/>
    <div className="student-item-input">
      <input ref={inputRef} id={id} className="sys-input" type="text" role="combobox" value={query}
        placeholder="Search item name or stock code" autoComplete="off" autoCapitalize="none" spellCheck={false}
        required disabled={disabled} aria-expanded={expanded} aria-controls={`${id}-results`} aria-autocomplete="list"
        aria-activedescendant={expanded && activeItem ? `${id}-option-${activeItem.id}` : undefined}
        aria-describedby={`${id}-hint`}
        onFocus={() => { setOpen(true); setActiveIndex(-1); }}
        onClick={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setSelectedId(""); setActiveIndex(-1); setOpen(true); event.target.setCustomValidity(event.target.value ? "Choose an item from the search results." : ""); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => !expanded ? (event.key === "ArrowDown" ? 0 : matches.length - 1) : event.key === "ArrowDown" ? Math.min(index + 1, matches.length - 1) : index <= 0 ? matches.length - 1 : index - 1);
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault();
            if (activeItem) choose(activeItem);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
        }}/>
      {query && <button type="button" className="student-item-clear" aria-label="Clear selected item or search" disabled={disabled} onClick={() => { setQuery(""); setSelectedId(""); setOpen(true); setActiveIndex(-1); inputRef.current?.setCustomValidity(""); inputRef.current?.focus(); }}>×</button>}
    </div>
    {expanded && <div className="student-item-results">
      <ul id={`${id}-results`} role="listbox" aria-label="Matching supplies">
        {matches.map((item, index) => <li id={`${id}-option-${item.id}`} key={item.id} role="option" aria-selected={selectedId === item.id}
          className={activeIndex === index ? "student-item-option is-active" : "student-item-option"}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
          <strong>{item.name}</strong><span>{item.sku} · {item.unit}</span>
        </li>)}
      </ul>
      {!matches.length && <p>No items found. Try another name or stock code.</p>}
    </div>}
    <small id={`${id}-hint`} role="status">{selected ? `Selected: ${selected.name} · ${selected.sku}. Unit: ${selected.unit}.` : expanded ? `${matches.length} matching ${matches.length === 1 ? "item" : "items"}. Choose an item from the results.` : "Type to search, then choose an item from the results."}</small>
  </div>;
}
