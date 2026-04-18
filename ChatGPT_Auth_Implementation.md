# Implementação da API e Autenticação do ChatGPT (Codex)

Este documento detalha como foi arquitetada e implementada a autenticação com o ChatGPT no aplicativo NEO através do fluxo OAuth 2.0 (codex).

## Como foi feito

A aplicação implementa o fluxo de **OAuth 2.0 com PKCE (Proof Key for Code Exchange)**. Como um aplicativo desktop (Electron) é considerado um cliente público em que não é possível armazenar um `client_secret` de forma segura, o PKCE é utilizado para garantir que ninguém possa interceptar e usar o código de autorização durante o processo de redirect.

O cliente utiliza o Client ID público do `codex_cli` (`app_EMoamEEZ73f0CkXaXp7hrann`), permitindo que a autenticação utilize as credenciais que os usuários do ChatGPT (especialmente Plus/Pro) já possuem. Desta forma, o app obtém os tokens de acesso de maneira simplificada, e a requisição de escopo inclui permissões para uso dos modelos.

##  O Fluxo de Autenticação e Login

O controlador `OpenAIOAuthController` gerencia todo o fluxo de entrada. Para realizar o login do usuário, a aplicação segue estes passos (modo automático):

1. **Geração do PKCE**: Cria uma chave aleatória (`codeVerifier`), que não é enviada na requisição inicial, e o `codeChallenge` (hash S-256 da chave), que é incluído na URL de autorização.
2. **Servidor Loopback**: Um servidor local temporário é iniciado (`http://localhost:1455/auth/callback`) para aguardar o callback de autorização.
3. **Redirecionamento**: A aplicação abre o navegador padrão do usuário na URL `auth.openai.com/oauth/authorize`, contendo as informações e os escopos (`openid`, `profile`, `email`, `offline_access`, `model.request`).
4. **Callback de Resposta**: Após o usuário autorizar o aplicativo na interface web, a OpenAI redireciona o navegador de volta para a porta local, enviando o parâmetro `code` e os dados `state`.
5. **Troca do Código**: Com o `code` capturado e o `codeVerifier` previamente gerado, o aplicativo faz uma chamada local (backend/Electron) ao endpoint `oauth/token` da OpenAI para trocar esses dados pelo `access_token`, `refresh_token` e pela duração de validade (`expires_in`).

*Fallbacks (Modo Manual)*: Se a porta 1455 estiver ocupada e o servidor local não iniciar, a aplicação exibe um campo para que o usuário cole a URL onde foi feito o redirecionamento ou insira manualmente o código na UI, sem interromper a jornada de logon.

## Utilização e Armazenamento dos Tokens

O gerenciamento é implementado na camada `apps/desktop/src/main/auth/tokenStore.ts`:
- **Persistência Segura**: Os tokens (`access_token` e `refresh_token`) não são gravados em texto claro. Tudo é passado pela classe `KeyStorage` que encripta os dados (geralmente usando o cofre de senhas do SO via nativo do Electron `safeStorage`, ou AES-GCM como fallback).
- **Armazenamento de Múltiplos Perfis**: O TokenStore pode manter múltiplos perfis simultâneos autenticados no disco (salvos no `userData/auth/profiles.enc`). Um perfil "ativo" pode ser determinado, e todos suportam campos como Expiração, Account ID, Label do Perfil, etc.
- Em tempo de execução (runtime cache), os tokens descriptografados ficam na memória apenas quando solicitados para realizar transações seguras.

## Refresh Automático (Renovação da Sessão)

O `apps/desktop/src/main/auth/tokenRefresher.ts` cuida da renovação silenciosa dos acessos antes que eles expirem, garantindo fluidez:

- **Mecânica de Refresh**: Sempre que o aplicativo necessita de um token para instanciar as chamadas de modelo, ele verifica se o token está a menos de **60 segundos de expirar** (60.000 ms). Se estiver, o processo de renovação é alavancado sob os panos via o `grant_type: refresh_token`.
- **Prevenção de Condições de Corrida (Mutex Lock)**: Para evitar que mais de uma requisição simultânea dispare o fluxo de refresh e acabe inváliando os tokens atuais pela sobreposição (já que o token retornado é rotacionado pela OpenAI), a implementação introduz um sistema de Lock/Mutex via promises. Se houver um "in-flight promise" ocorrendo no perfil, todos os próximos pedidos esperam resolver o token já em trânsito antes de retornar.

## Arquivos e Módulos de Referência (Desktop / Main)

Ao inspecionar a implementação, os desenvolvedores devem se guiar pelos seguintes arquivos presentes no projeto:

- **`apps/desktop/src/main/auth/openaiOAuth.ts`**: Controlador-chefe do fluxo inteiro. Contém as diretivas de montagem da URL via parâmetros codex e as lógicas de finalização automáticas vs. manuais.
- **`apps/desktop/src/main/auth/authConfig.ts`**: Contém as constantes críticas como `CLIENT_ID`, os URLs de autorização (`auth.openai.com`) e os escopos modelados.
- **`apps/desktop/src/main/auth/pkce.ts`**: Criptografia em Node (Módulo Crypto puro), útil para entender como `codeVerifier`, `challenge` (sha256) e strings aleatórias ajudam os processos `state` a prevenir CSRF e injecionais de MITM na camada local. 
- **`apps/desktop/src/main/auth/oauthServer.ts`**: É o servidor temporário http e express-like levantado para agarrar o loopback callback no momento em que o navegador volta o controle ao app.
- **`apps/desktop/src/main/auth/tokenStore.ts`**: Persistência; responsável por criar, atualizar os tokens na memória e também persistir cifrado no File System nativo (`profiles.enc`). Manipula entidades de `AuthProfile`.
- **`apps/desktop/src/main/auth/tokenRefresher.ts`**: Lida integralmente com expiração. Interage com a OpenAI disparando o Refresh Token para pegar os novos access tokens sem intervenção usando filas e "mutexes".
