export default function UploadBar({ value, label }) {
  if (value == null) {
    return null;
  }
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  const text = label || `A enviar ${percent}%`;
  return (
    <div
      className="upload-progress"
      role="progressbar"
      aria-label={text}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="upload-progress-track">
        <div className="upload-progress-bar" style={{ width: `${percent}%` }} />
      </div>
      <span>{text}</span>
    </div>
  );
}
