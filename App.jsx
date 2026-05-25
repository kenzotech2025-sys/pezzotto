import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD ? window.location.origin : "http://localhost:3000");

function parseInterests(value) {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function nowLabel() {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function systemMessage(text) {
  return {
    id: crypto.randomUUID(),
    kind: "system",
    text,
    sentAt: nowLabel()
  };
}

function chatMessage(text, mine = false) {
  return {
    id: crypto.randomUUID(),
    kind: mine ? "mine" : "stranger",
    text,
    sentAt: nowLabel()
  };
}

function AdBanner() {
  return (
    <div
      id="ad-banner"
      className="my-4 flex min-h-20 w-full items-center justify-center border border-dashed border-amber-300/60 bg-amber-300/10 px-4 py-3 text-center text-sm font-bold text-amber-100"
    >
      {/* <!-- Inserisci qui l'embed code del network pubblicitario (es. Adsterra) --> */}
      Spazio pubblicitario
    </div>
  );
}

function VipButton({ compact = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`animate-pulse bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 font-black text-stone-950 shadow-lg shadow-amber-500/20 transition hover:scale-[1.02] hover:from-amber-100 hover:to-yellow-300 ${
        compact ? "px-3 py-2 text-xs" : "w-full px-5 py-4 text-base"
      }`}
    >
      Passa a Pezzotto VIP 👑
    </button>
  );
}

function VipModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
      <div className="w-full max-w-md border border-amber-300/60 bg-stone-950 p-6 shadow-2xl shadow-black">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-amber-300">Pezzotto VIP</p>
            <h2 className="mt-2 text-3xl font-black text-white">Upgrade fittizio</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-white/10 px-3 py-1 text-sm font-black text-stone-200 hover:bg-white/10"
            aria-label="Chiudi modal VIP"
          >
            X
          </button>
        </div>

        <ul className="mt-5 space-y-3 text-sm text-stone-200">
          <li className="border border-white/10 bg-white/[0.04] px-3 py-3">Filtro Genere</li>
          <li className="border border-white/10 bg-white/[0.04] px-3 py-3">Zero Pubblicita'</li>
          <li className="border border-white/10 bg-white/[0.04] px-3 py-3">Priorita' nel matchmaking</li>
        </ul>

        <button
          type="button"
          onClick={() => console.log("Stripe checkout placeholder")}
          className="mt-6 w-full bg-emerald-300 px-5 py-3 text-sm font-black text-stone-950 transition hover:bg-emerald-200"
        >
          Paga con Stripe
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const localStreamRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const messageEndRef = useRef(null);

  const [userId, setUserId] = useState("");
  const [onlineCount, setOnlineCount] = useState(0);
  const [interestsInput, setInterestsInput] = useState("");
  const [mode, setMode] = useState(null);
  const [status, setStatus] = useState("home");
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [peerUser, setPeerUser] = useState(null);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const [isServerWaking, setIsServerWaking] = useState(true);
  const [isVipOpen, setIsVipOpen] = useState(false);

  const interests = useMemo(() => parseInterests(interestsInput), [interestsInput]);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => setIsServerWaking(false));
    socket.on("connect_error", () => setIsServerWaking(true));
    socket.on("identity", ({ userId: nextUserId }) => setUserId(nextUserId));
    socket.on("online-count", setOnlineCount);

    socket.on("searching", ({ mode: nextMode }) => {
      setMode(nextMode);
      setStatus("searching");
      setPeerUser(null);
      setMessages([systemMessage("Cerco un Pezzotto-Stranger...")]);
    });

    socket.on("matched", async ({ mode: nextMode, peer, isInitiator }) => {
      setMode(nextMode);
      setStatus("connected");
      setPeerUser(peer);
      setIsPeerTyping(false);
      setMessages((current) => [
        ...current.filter((message) => message.kind !== "system" || !message.text.startsWith("Cerco")),
        systemMessage("Pezzotto-Stranger si e' connesso")
      ]);

      if (nextMode === "video") {
        await startPeerConnection(isInitiator);
      }
    });

    socket.on("message", (message) => {
      setMessages((current) => [...current, chatMessage(message.text, false)]);
    });

    socket.on("typing", setIsPeerTyping);

    socket.on("webrtc-signal", (signal) => {
      handleWebRtcSignal(signal);
    });

    socket.on("stranger-disconnected", () => {
      cleanupPeer();
      setPeerUser(null);
      setStatus("idle");
      setIsPeerTyping(false);
      setMessages((current) => [...current, systemMessage("Pezzotto-Stranger si e' disconnesso")]);
    });

    socket.on("idle", () => {
      cleanupPeer();
      setStatus("home");
      setMode(null);
      setPeerUser(null);
      setMessages([]);
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPeerTyping]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && mode) {
        event.preventDefault();
        findAnother(mode);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, interests]);

  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaError("");
      return stream;
    } catch {
      setMediaError("Permessi camera/microfono negati o dispositivo non disponibile.");
      return null;
    }
  }

  async function createPeerConnection() {
    const stream = await ensureLocalStream();
    if (!stream || !socketRef.current) return;

    peerConnectionRef.current?.close();
    pendingIceCandidatesRef.current = [];

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("webrtc-signal", {
          type: "candidate",
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    peerConnection.onconnectionstatechange = () => {
      if (["closed", "disconnected", "failed"].includes(peerConnection.connectionState)) {
        setRemoteStream(null);
      }
      if (peerConnection.connectionState === "failed") {
        setMediaError("Connessione video interrotta. Prova a incontrare un altro utente.");
      }
    };

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }

  async function startPeerConnection(isInitiator) {
    const peerConnection = await createPeerConnection();
    if (!peerConnection || !isInitiator) return;

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socketRef.current?.emit("webrtc-signal", {
      type: "offer",
      sdp: peerConnection.localDescription
    });
  }

  async function flushPendingCandidates(peerConnection) {
    while (pendingIceCandidatesRef.current.length) {
      const candidate = pendingIceCandidatesRef.current.shift();
      await peerConnection.addIceCandidate(candidate);
    }
  }

  async function handleWebRtcSignal(signal) {
    let peerConnection = peerConnectionRef.current;
    if (!peerConnection) {
      peerConnection = await createPeerConnection();
    }
    if (!peerConnection) return;

    if (signal.type === "offer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await flushPendingCandidates(peerConnection);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socketRef.current?.emit("webrtc-signal", {
        type: "answer",
        sdp: peerConnection.localDescription
      });
      return;
    }

    if (signal.type === "answer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await flushPendingCandidates(peerConnection);
      return;
    }

    if (signal.type === "candidate" && signal.candidate) {
      const candidate = new RTCIceCandidate(signal.candidate);
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
      } else {
        pendingIceCandidatesRef.current.push(candidate);
      }
    }
  }

  function cleanupPeer() {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingIceCandidatesRef.current = [];
    setRemoteStream(null);
  }

  function startSearch(nextMode) {
    cleanupPeer();
    setMediaError("");
    setMode(nextMode);
    setStatus("searching");
    setMessages([systemMessage("Cerco un Pezzotto-Stranger...")]);
    socketRef.current?.emit("start", {
      mode: nextMode,
      interests
    });
  }

  function findAnother(nextMode = mode) {
    if (!nextMode) return;
    startSearch(nextMode);
  }

  function stopChat() {
    socketRef.current?.emit("stop");
    cleanupPeer();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    const text = messageInput.trim();
    if (!text || status !== "connected") return;

    socketRef.current?.emit("message", { text });
    socketRef.current?.emit("typing", false);
    setMessages((current) => [...current, chatMessage(text, true)]);
    setMessageInput("");
  }

  function handleMessageChange(event) {
    setMessageInput(event.target.value);
    if (status !== "connected") return;

    socketRef.current?.emit("typing", true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("typing", false);
    }, 900);
  }

  const isChatVisible = status !== "home";

  return (
    <main className="min-h-screen bg-stone-950 text-stone-50">
      {isServerWaking && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-stone-950/95 px-4 text-center">
          <div>
            <div className="mx-auto mb-5 h-14 w-14 animate-spin border-4 border-white/15 border-t-emerald-300" />
            <p className="text-xl font-black text-white">Sveglia del server in corso...</p>
            <p className="mt-2 max-w-sm text-sm text-stone-300">
              Potrebbe richiedere fino a 30 secondi la prima volta
            </p>
          </div>
        </div>
      )}

      {isVipOpen && <VipModal onClose={() => setIsVipOpen(false)} />}

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <button
            className="group text-left"
            type="button"
            onClick={stopChat}
            aria-label="Torna alla home"
          >
            <h1 className="text-3xl font-black tracking-normal text-white sm:text-4xl">Pezzotto</h1>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-300">anonymous random chat</p>
          </button>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            {isChatVisible && <VipButton compact onClick={() => setIsVipOpen(true)} />}
            <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-emerald-100">
              {onlineCount || 1} utenti online
            </span>
            {userId && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-stone-300">
                {userId}
              </span>
            )}
          </div>
        </header>

        <AdBanner />

        {!isChatVisible ? (
          <section className="grid flex-1 place-items-center py-8">
            <div className="w-full max-w-2xl">
              <div className="mb-8">
                <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Entra, parla, sparisci
                </p>
                <h2 className="text-4xl font-black leading-tight text-white sm:text-6xl">
                  Incontra uno sconosciuto a caso.
                </h2>
              </div>

              <div className="space-y-5 border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 sm:p-6">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-stone-200">Interessi</span>
                  <input
                    value={interestsInput}
                    onChange={(event) => setInterestsInput(event.target.value)}
                    placeholder="musica, gaming, cinema"
                    className="w-full border border-white/10 bg-stone-900 px-4 py-3 text-base text-white outline-none transition focus:border-emerald-300"
                  />
                </label>

                {interests.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {interests.map((interest) => (
                      <span key={interest} className="bg-cyan-300 px-2.5 py-1 text-xs font-bold text-stone-950">
                        {interest}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => startSearch("text")}
                    className="bg-emerald-300 px-5 py-4 text-base font-black text-stone-950 transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  >
                    Chat Testuale
                  </button>
                  <button
                    type="button"
                    onClick={() => startSearch("video")}
                    className="bg-cyan-300 px-5 py-4 text-base font-black text-stone-950 transition hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                  >
                    Video Chat
                  </button>
                </div>

                <VipButton onClick={() => setIsVipOpen(true)} />
              </div>
            </div>
          </section>
        ) : (
          <section className="grid flex-1 gap-4 py-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <div className="flex min-h-[320px] flex-col border border-white/10 bg-black">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-white">
                    {status === "connected" ? "Connesso" : "In attesa"}
                  </p>
                  <p className="text-xs text-stone-400">
                    {peerUser ? peerUser.userId : "Matchmaking casuale FIFO con priorita' agli interessi"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => findAnother(mode)}
                  className="bg-rose-400 px-4 py-2 text-sm font-black text-stone-950 transition hover:bg-rose-300"
                >
                  Stop/Incontra un altro
                </button>
              </div>

              {mode === "video" ? (
                <div className="relative grid flex-1 place-items-center overflow-hidden bg-stone-950">
                  {remoteStream ? (
                    <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
                  ) : (
                    <div className="px-5 text-center text-stone-400">
                      {mediaError || (status === "searching" ? "Cerco qualcuno con cui parlare..." : "Video remoto in arrivo...")}
                    </div>
                  )}

                  {localStream && (
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="absolute bottom-4 right-4 h-32 w-44 border border-white/20 object-cover shadow-xl"
                    />
                  )}
                </div>
              ) : (
                <div className="grid flex-1 place-items-center bg-stone-900 px-6 text-center">
                  <div>
                    <p className="text-2xl font-black text-white">Chat Testuale</p>
                    <p className="mt-2 max-w-md text-sm text-stone-400">
                      {status === "searching"
                        ? "Appena entra un utente compatibile, Pezzotto apre la stanza privata."
                        : "La conversazione e' anonima e volatile."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <aside className="flex min-h-[520px] flex-col border border-white/10 bg-stone-900">
              <div className="border-b border-white/10 px-4 py-3">
                <p className="font-black text-white">Chat</p>
                <p className="text-xs text-stone-400">Premi Esc per cercare un nuovo utente</p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.kind === "system"
                        ? "text-center text-xs font-semibold uppercase tracking-wide text-stone-500"
                        : message.kind === "mine"
                          ? "ml-auto max-w-[85%] bg-emerald-300 px-3 py-2 text-stone-950"
                          : "mr-auto max-w-[85%] bg-white px-3 py-2 text-stone-950"
                    }
                  >
                    {message.kind === "system" ? (
                      message.text
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
                        <p className="mt-1 text-right text-[10px] font-bold opacity-60">{message.sentAt}</p>
                      </>
                    )}
                  </div>
                ))}
                {isPeerTyping && (
                  <p className="text-sm italic text-cyan-200">L'altro utente sta scrivendo...</p>
                )}
                <div ref={messageEndRef} />
              </div>

              <form onSubmit={sendMessage} className="flex gap-2 border-t border-white/10 p-3">
                <input
                  value={messageInput}
                  onChange={handleMessageChange}
                  disabled={status !== "connected"}
                  placeholder={status === "connected" ? "Scrivi un messaggio..." : "Aspetta il match..."}
                  className="min-w-0 flex-1 border border-white/10 bg-stone-950 px-3 py-3 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={status !== "connected" || !messageInput.trim()}
                  className="bg-emerald-300 px-5 py-3 text-sm font-black text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
                >
                  Invia
                </button>
              </form>
            </aside>
          </section>
        )}
      </div>
    </main>
  );
}
