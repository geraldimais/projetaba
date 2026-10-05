import { useEffect, useRef } from "react";

function applySound(video, audible) {
  if (!video) {
    return;
  }
  video.muted = !audible;
  video.defaultMuted = !audible;
  video.volume = audible ? 1 : 0;
}

export default function VideoLayer({
  token,
  fileId,
  clips,
  isPresenter,
  emitMedia,
  follow,
  audible = false,
}) {
  const refs = useRef(new Map());
  const clipKey = (clips || []).map((clip) => `${clip.file}:${clip.index}`).join("|");

  useEffect(() => {
    for (const video of refs.current.values()) {
      applySound(video, audible);
    }
  }, [audible, clipKey]);

  useEffect(() => {
    if (isPresenter || !follow) {
      return undefined;
    }
    for (const video of refs.current.values()) {
      applySound(video, audible);
      const drift = Math.abs((video.currentTime || 0) - (follow.time || 0));
      if (drift > 0.45) {
        video.currentTime = follow.time || 0;
      }
      if (follow.playing) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
    return undefined;
  }, [follow, isPresenter, audible]);

  useEffect(() => {
    const nodes = refs.current;
    return () => {
      for (const video of nodes.values()) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      nodes.clear();
    };
  }, [fileId, clipKey]);

  function emit(video) {
    if (!isPresenter || !emitMedia) {
      return;
    }
    emitMedia({
      playing: !video.paused,
      time: video.currentTime || 0,
    });
  }

  if (!clips?.length) {
    return null;
  }

  return (
    <>
      {clips.map((clip) => (
        <video
          key={`${clip.file}-${clip.index}`}
          ref={(node) => {
            if (node) {
              refs.current.set(clip.file, node);
              applySound(node, audible);
            } else {
              refs.current.delete(clip.file);
            }
          }}
          className={`slide-video${clip.width === 1 && clip.height === 1 ? " fill" : ""}`}
          style={{
            left: `${Math.max(0, clip.left || 0) * 100}%`,
            top: `${Math.max(0, clip.top || 0) * 100}%`,
            width: `${Math.min(1, clip.width || 1) * 100}%`,
            height: `${Math.min(1, clip.height || 1) * 100}%`,
          }}
          src={
            clip.src ||
            `/api/sessions/${encodeURIComponent(token)}/media/${encodeURIComponent(fileId)}/${encodeURIComponent(clip.file)}`
          }
          playsInline
          autoPlay={Boolean(isPresenter)}
          muted={!audible}
          controls={Boolean(isPresenter)}
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          onPlay={(event) => emit(event.currentTarget)}
          onPause={(event) => emit(event.currentTarget)}
          onSeeked={(event) => emit(event.currentTarget)}
          onVolumeChange={(event) => applySound(event.currentTarget, audible)}
          onTimeUpdate={(event) => {
            if (isPresenter && event.currentTarget.currentTime % 1 < 0.25) {
              emit(event.currentTarget);
            }
          }}
        />
      ))}
    </>
  );
}
