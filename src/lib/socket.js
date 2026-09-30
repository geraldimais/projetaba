import { io } from "socket.io-client";

export function connectSession({ token, role, presenterKey }) {
  return io({
    path: "/socket.io",
    auth: { token, role, presenterKey },
    transports: ["websocket", "polling"],
  });
}
