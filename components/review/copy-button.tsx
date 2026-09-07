import { useState } from "react";
import { Check, Copy } from "lucide-react";
export function CopyButton({ text, label = "Copy as Markdown" }: { text: string; label?: string }) {
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
      <button className="control" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : label}
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
