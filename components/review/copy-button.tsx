import { useState } from "react";
import { Check, Copy } from "lucide-react";
export function CopyButton({
  text,
  label = "Copy as Markdown",
  iconOnly = false,
}: {
  text: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Select and copy the Markdown below.");
    }
  }
  return (
    <>
      <button
        className={iconOnly ? "icon-button" : "control"}
        onClick={copy}
        aria-label={copied ? "Copied" : label}
        title={iconOnly ? (copied ? "Copied" : label) : undefined}
      >
        {copied ? <Check /> : <Copy />}
        {!iconOnly && (copied ? "Copied" : label)}
      </button>
      {error && (
        <label className="copy-fallback">
          {error}
          <textarea readOnly value={text} onFocus={(e) => e.target.select()} />
        </label>
      )}
    </>
  );
}
