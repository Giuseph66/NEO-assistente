# Prompt para implementar a página mobile do Phone Mic

Você vai implementar a página web mobile do recurso "Phone Mic" para um app Electron chamado NEO.

Contexto:
- O app desktop já sobe um servidor HTTP + WebSocket local.
- A URL da página é algo como: `http://IP_LOCAL:8790/phone-mic?token=TOKEN`.
- O WebSocket é: `ws://IP_LOCAL:8790/phone-mic/ws?token=TOKEN`.
- A página será acessada pelo navegador do celular na mesma rede Wi-Fi.
- O objetivo é usar o celular como microfone remoto para o desktop.

Requisitos da página:
1. Ler `token` da query string.
2. Montar o WebSocket usando o mesmo host da página:
   - `ws://${location.host}/phone-mic/ws?token=${token}` quando HTTP.
   - `wss://${location.host}/phone-mic/ws?token=${token}` quando HTTPS.
3. Ter UI mobile simples e responsiva:
   - status de conexão;
   - botão grande "Gravar" / "Parar";
   - medidor visual de nível;
   - contador de tempo gravando;
   - mensagens de erro claras.
4. Ao clicar em "Gravar":
   - pedir permissão de microfone com `navigator.mediaDevices.getUserMedia({ audio: true })`;
   - usar `AudioContext` com sample rate preferencial de 16000 quando possível;
   - capturar áudio do microfone;
   - converter para PCM16 mono;
   - enviar frames binários pelo WebSocket.
5. Protocolo de envio:
   - Enviar binário PCM16 little-endian.
   - Frames de 20ms a 100ms são aceitáveis.
   - Também enviar mensagens JSON opcionais com nível:
     `{"type":"level","level":0.42,"rms":1234}`.
6. Ao clicar em "Parar":
   - parar tracks do MediaStream;
   - fechar/desconectar AudioWorklet/ScriptProcessor;
   - manter WebSocket aberto para nova gravação, se possível.
7. Preferir `AudioWorklet` para baixa latência.
   - Se não estiver disponível, usar fallback `ScriptProcessorNode`.
8. Segurança/UX:
   - Se faltar token, mostrar erro.
   - Se WebSocket fechar por token inválido, mostrar erro.
   - Se a página não estiver em HTTPS e o navegador bloquear microfone, explicar que precisa mesma rede/HTTPS.

Implementação esperada:
- Entregar um único HTML completo com CSS e JavaScript inline, sem bundler.
- Não usar dependências externas.
- Visual escuro, simples, com botão principal grande.
- O JavaScript deve ser claro e comentado apenas nos pontos críticos.

Detalhe técnico importante:
- O desktop calcula nível a partir de PCM16, então os frames binários precisam ser `Int16Array` little-endian.
- Converter float `[-1, 1]` para int16 assim:
  - `const sample = Math.max(-1, Math.min(1, value));`
  - `pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;`

Critério de aceite:
- Abrir a URL no celular.
- Conectar ao WebSocket.
- Clicar em "Gravar".
- O desktop deve mostrar cliente conectado, chunks/KB aumentando e nível mexendo.
