# Pezzotto

Clone minimale in stile Omegle con chat anonima testuale e video 1-a-1 casuale.

## Avvio locale

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend Socket.io/Express: `http://localhost:4000`

## Script utili

```bash
npm run server
npm run client
npm run build
```

## Note

- Nessun login e nessun database.
- I messaggi sono solo inoltrati via Socket.io e non vengono salvati.
- Il matchmaking usa code FIFO separate per `text` e `video`, dando priorita' al primo utente in coda con almeno un interesse in comune.
