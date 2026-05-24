import { getApiBase } from "@renderer/lib/api";
import { cn } from "@renderer/lib/utils";
import { Check, MessageSquare, Send } from "lucide-react";
import { useCallback, useState } from "react";

const feedbackTypes = [
  { value: "general", label: "General" },
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
] as const;

export default function FeedbackPage(): React.JSX.Element {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<string>("general");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!message.trim()) return;
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`${getApiBase()}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          type,
          email: email.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: "Failed to send" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSent(true);
      setMessage("");
      setEmail("");
      setType("general");
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send feedback");
    } finally {
      setSending(false);
    }
  }, [message, email, type]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Feedback</h1>
        <p className="text-muted-foreground mt-1">
          Share your thoughts, report bugs, or suggest features.
        </p>
      </div>

      <div className="space-y-4">
        {/* Type selector */}
        <div className="space-y-2">
          <span className="text-sm font-medium">Type</span>
          <div className="flex gap-2">
            {feedbackTypes.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  type === option.value
                    ? "border-primary bg-accent text-accent-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Message textarea */}
        <div className="space-y-2">
          <label htmlFor="feedback-message" className="text-sm font-medium">
            Message
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what's on your mind..."
            rows={5}
            className="border-border bg-card text-foreground placeholder:text-muted-foreground w-full resize-none rounded-lg border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Email (optional) */}
        <div className="space-y-2">
          <label htmlFor="feedback-email" className="text-sm font-medium">
            Email{" "}
            <span className="text-muted-foreground font-normal">
              (optional, for follow-up)
            </span>
          </label>
          <input
            id="feedback-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="border-border bg-card text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Error */}
        {error && <p className="text-destructive text-sm">{error}</p>}

        {/* Submit button */}
        <button
          type="button"
          onClick={submit}
          disabled={!message.trim() || sending}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
            sent
              ? "bg-primary/10 text-primary"
              : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
          )}
        >
          {sent ? (
            <>
              <Check size={16} />
              Sent! Thanks for your feedback.
            </>
          ) : sending ? (
            <>
              <MessageSquare size={16} className="animate-pulse" />
              Sending...
            </>
          ) : (
            <>
              <Send size={16} />
              Send Feedback
            </>
          )}
        </button>
      </div>
    </div>
  );
}
