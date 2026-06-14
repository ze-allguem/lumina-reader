import uuid
import re
import os
import html
import asyncio
import httpx
from typing import Dict
from io import BytesIO
from pathlib import Path
import edge_tts

from fastapi import Request
from fastapi.responses import FileResponse, StreamingResponse, HTMLResponse
from fastapi import FastAPI, File, UploadFile, Header, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader

app = FastAPI()

# Middleware de Content Security Policy (CSP) seguro e aderente às melhores práticas
@app.middleware("http")
async def add_csp_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-eval'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "media-src 'self' blob:; "
        "connect-src 'self' ws: wss:;"
    )
    return response



# Permite CORS para desenvolvimento local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Carrega arquivo .env local se existir
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            if "=" in line:
                key_env, val_env = line.strip().split("=", 1)
                os.environ[key_env] = val_env

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = (
    "Você é um formatador HTML estrito de textos editoriais e técnicos.\n"
    "Sua única tarefa é receber o texto bruto extraído de UMA ÚNICA PÁGINA de PDF e estruturá-lo visualmente em HTML, mantendo 100% de fidelidade ao texto original.\n\n"
    "REGRA ZERO — FIDELIDADE TEXTUAL ABSOLUTA:\n"
    "- NÃO altere, resuma, adicione, omita, reescreva, corrija, traduza ou parafraseie NENHUMA palavra.\n"
    "- Retorne APENAS o HTML, sem comentários, notas ou blocos markdown.\n\n"
    "COMO IDENTIFICAR TÍTULOS (MUITO IMPORTANTE):\n"
    "- CRITÉRIO RÍGIDO: Só use <h2> se a linha for CURTA (no máximo 7 palavras) e realmente nomear um capítulo, seção ou parte.\n"
    "- Exemplos de títulos verdadeiros: \"Capítulo I\", \"Seção II\", \"Das Disposições Gerais\", \"INTRODUÇÃO\", \"CONCLUSÃO\".\n"
    "- FRASES longas ou parágrafos completos NUNCA são títulos, mesmo que estejam na primeira linha da página.\n"
    "- Se uma linha parece título mas tem mais de 7 palavras, transforme em <div class=\"reading-block\"><p>...</p></div> normal.\n"
    "- Cabeçalhos e rodapés de página NÃO são títulos.\n"
    "- Numeração de artigos (\"Art. 3º\", \"Art. 1o\") use <h3> fora de cards.\n\n"
    "ESTRUTURA HTML:\n"
    "1. Parágrafos comuns:\n"
    "   <div class=\"reading-block\"><p>Texto original integral...</p></div>\n"
    "2. Definição (conceitos, termos fundamentais):\n"
    "   <div class=\"reading-block definition\"><span class=\"badge\">Definição</span><p><strong>Termo:</strong> Explicação...</p></div>\n"
    "3. Alerta/Atenção (regras críticas, exceções legais):\n"
    "   <div class=\"reading-block warning\"><span class=\"badge\">Atenção</span><p>Texto original...</p></div>\n"
    "4. Destaque (artigos principais, regras gerais):\n"
    "   <div class=\"reading-block bordered\"><span class=\"badge\">Destaque</span><p>Texto original...</p></div>\n"
    "5. Título de capítulo/seção (MÁXIMO 7 PALAVRAS):\n"
    "   <h2 class=\"reading-section-title\">Título Curto</h2>\n"
    "6. Subtítulo / numeração de artigo:\n"
    "   <h3>Art. X</h3>\n"
    "7. Ênfases internas: <strong> para termos centrais, <mark> para trechos cruciais.\n\n"
    "EXEMPLO:\n"
    "— ENTRADA (1 página):\n"
    "Art. 3º O ensino será ministrado com base nos seguintes princípios: I - igualdade de condições para acesso e permanência na escola;\n\n"
    "— SAÍDA:\n"
    "<h3>Art. 3º</h3>\n"
    "<div class=\"reading-block\"><p>O <strong>ensino</strong> será ministrado com base nos seguintes princípios: I - <mark>igualdade de condições para acesso e permanência na escola</mark>;</p></div>"
)

# Armazenamento em memória dos blocos de cada sessão
sessions: Dict[str, list] = {
    "mock_capital": [
        '<h2 class="reading-section-title">Seção 1: Mercadoria e Dinheiro</h2>',
        '<div class="reading-block definition"><p><strong>Mercadoria:</strong> É o objeto externo, uma coisa que, por suas propriedades, satisfaz necessidades humanas.</p></div>',
        '<div class="reading-block"><p>A utilidade de uma coisa faz dela um <strong>valor de uso</strong>. Mas esta utilidade não flutua no ar. Condicionada pelas propriedades do corpo da mercadoria, ela não existe sem ele.</p></div>',
        '<div class="reading-block"><p><strong>O Fetiche da Mercadoria:</strong> Um fenômeno onde as relações sociais entre pessoas são mascaradas por relações entre <strong>coisas</strong> e <strong>valores de troca</strong>.</p></div>',
        '<div class="reading-block bordered"><p><strong>1. Valor de Uso:</strong> Refere-se à utilidade de um objeto. O corpo da própria mercadoria, como o ferro, o trigo, o diamante, etc.</p></div>',
        '<div class="reading-block bordered"><p><strong>2. Valor de Troca:</strong> A proporção em que valores de uso de uma espécie se trocam por outros, relação que muda constantemente.</p></div>'
    ],
    "mock_acessibilidade": [
        '<h2 class="reading-section-title">Acessibilidade Digital</h2>',
        '<div class="reading-block definition"><p><strong>Acessibilidade:</strong> É a garantia de que qualquer pessoa, independentemente de suas capacidades físicas ou cognitivas, consiga perceber, compreender, navegar e interagir com produtos digitais.</p></div>',
        '<div class="reading-block"><p>Desenvolver com acessibilidade significa remover barreiras na web. Isso beneficia não apenas pessoas com deficiências permanentes, mas também aquelas com limitações temporárias ou situacionais.</p></div>',
        '<div class="reading-block bordered"><p><strong>Regra de Ouro:</strong> Sempre forneça textos alternativos para imagens, garanta contraste de cores adequado e permita navegação completa via teclado.</p></div>'
    ],
    "mock_design": [
        '<h2 class="reading-section-title">O Design das Coisas</h2>',
        '<div class="reading-block definition"><p><strong>Affordance:</strong> É a relação entre as propriedades de um objeto físico e as capacidades do agente que determinam como o objeto pode ser usado.</p></div>',
        '<div class="reading-block"><p>Quando as coisas simples precisam de fotos, instruções ou avisos, o design falhou. Um bom design deve ser intuitivo e comunicar sua função naturalmente.</p></div>',
        '<div class="reading-block bordered"><p><strong>Feedback:</strong> O princípio de enviar de volta informações sobre qual ação foi realizada e qual resultado foi alcançado. É crucial para o controle e aprendizado.</p></div>'
    ]
}

async def _call_groq(messages: list, max_attempts: int = 5) -> str | None:
    """Chama a API do Groq usando a chave do .env. Retorna o HTML ou None com retentativas e fallback de modelo."""
    groq_api_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_api_key:
        print("[Groq] Erro: GROQ_API_KEY não encontrada no ambiente.")
        return None

    headers = {
        "Authorization": f"Bearer {groq_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 4096,
    }

    base_delay = 3.0

    for attempt in range(1, max_attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                print(f"[Groq] Enviando texto para {payload['model']} (tentativa {attempt}/{max_attempts})...")
                response = await client.post(GROQ_URL, json=payload, headers=headers)
                
                if response.status_code == 200:
                    data = response.json()
                    content = data["choices"][0]["message"]["content"]
                    # Limpa delimitadores de código markdown que a IA possa ter retornado
                    content = re.sub(r"^```(?:html)?\s*\n?", "", content, flags=re.IGNORECASE)
                    content = re.sub(r"\n?```\s*$", "", content)
                    return content.strip()
                
                elif response.status_code == 429:
                    error_msg = ""
                    try:
                        error_msg = response.json().get("error", {}).get("message", "")
                    except Exception:
                        pass
                    
                    # SE O MODELO ATUAL FOR O 70B:
                    # Quando bater cota diária (TPD) ou por minuto (TPM), alterna instantaneamente para o modelo 8B
                    if payload["model"] == "llama-3.3-70b-versatile":
                        print(f"[Groq] Rate limit atingido no modelo 70B (429). Detalhes: {error_msg}")
                        print("[Groq] Alternando imediatamente para o modelo Llama 3.1 8B como fallback...")
                        payload["model"] = "llama-3.1-8b-instant"
                        # Tenta imediatamente no próximo ciclo do loop sem aguardar
                        continue
                    
                    # Se o modelo 8B também sofrer rate limit (raro), extrai o tempo de espera
                    wait_time = None
                    try:
                        ms_match = re.search(r"try again in (\d+(?:\.\d+)?)ms", error_msg, re.IGNORECASE)
                        if ms_match:
                            wait_time = float(ms_match.group(1)) / 1000.0
                        else:
                            s_match = re.search(r"try again in (\d+(?:\.\d+)?)s", error_msg, re.IGNORECASE)
                            if s_match:
                                wait_time = float(s_match.group(1))
                    except Exception:
                        pass
                    
                    # Caso falhe, tenta ler do cabeçalho retry-after
                    if wait_time is None:
                        retry_after = response.headers.get("retry-after")
                        if retry_after:
                            try:
                                wait_time = float(retry_after)
                            except ValueError:
                                pass
                    
                    if wait_time is None:
                        # Fallback para backoff exponencial
                        wait_time = base_delay * (2 ** (attempt - 1))
                    
                    # Garante um tempo mínimo de segurança
                    wait_time = max(wait_time, 1.0)
                    # Não exagera no tempo de espera máximo por tentativa
                    wait_time = min(wait_time, 15.0)
                    
                    print(f"[Groq] Rate limit atingido no modelo 8B (429). Aguardando {wait_time:.2f}s antes da tentativa {attempt + 1}...")
                    if attempt < max_attempts:
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        print(f"[Groq] Limite de tentativas ({max_attempts}) esgotado.")
                else:
                    print(f"[Groq] Erro da API ({response.status_code}): {response.text}")
                    # Para erros temporários do servidor (5xx), também tentamos novamente
                    if response.status_code >= 500:
                        wait_time = base_delay * (2 ** (attempt - 1))
                        print(f"[Groq] Erro temporário do servidor. Aguardando {wait_time:.2f}s antes da tentativa {attempt + 1}...")
                        if attempt < max_attempts:
                            await asyncio.sleep(wait_time)
                            continue
                    break
        except httpx.RequestError as exc:
            print(f"[Groq] Erro de rede ao conectar com a API: {exc}")
            wait_time = base_delay * (2 ** (attempt - 1))
            if attempt < max_attempts:
                print(f"[Groq] Aguardando {wait_time:.2f}s antes de tentar novamente (tentativa {attempt + 1})...")
                await asyncio.sleep(wait_time)
                continue
        except Exception as e:
            print(f"[Groq] Exceção inesperada ao chamar API: {e}")
            break
            
    return None

def organize_text_to_blocks(raw_text: str) -> list[str]:
    """Divide o texto em parágrafos com sentido completo (Fallback local)."""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return []
    
    # Tenta dividir por parágrafos reais (duas quebras de linha)
    raw_paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    
    # Se não achou parágrafos, junta linhas quebradas
    if len(raw_paragraphs) <= 1:
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        raw_paragraphs = []
        buffer = []
        for line in lines:
            buffer.append(line)
            word_count = len(' '.join(buffer).split())
            # Fecha o parágrafo se a linha termina com pontuação forte E o buffer tem conteúdo substancial
            if re.search(r'[.!?]$', line) and word_count > 7:
                raw_paragraphs.append(' '.join(buffer))
                buffer = []
        if buffer:
            raw_paragraphs.append(' '.join(buffer))
    
    # Se ainda não tem parágrafos, usa o texto inteiro como um bloco
    if not raw_paragraphs:
        raw_paragraphs = [text.strip()]
    
    # Mescla blocos muito curtos com o próximo (exceto enumerações e linhas com dois-pontos)
    merged = []
    for p in raw_paragraphs:
        words = p.split()
        is_short = len(words) <= 7
        is_enumeration = bool(re.match(r'^[IVXLCDM]+\s+[-–—]|^[a-z]\)\s|\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\b', p))
        ends_with_colon = p.rstrip().endswith(':')
        
        if is_short and not is_enumeration and not ends_with_colon and merged:
            # Mescla com o parágrafo anterior
            merged[-1] = merged[-1] + ' ' + p
        else:
            merged.append(p)
    
    blocks = []
    for p in merged:
        p_clean = p.strip()
        if not p_clean:
            continue
        p_escaped = html.escape(p_clean)
        
        # Detecta título de seção
        is_title = bool(re.match(r'^(TÍTULO|TITULO|CAPÍTULO|CAPITULO|SEÇÃO|SECA[OO]|SUBSEÇÃO|SUBSECAO)\b', p_clean, re.IGNORECASE))
        is_article = bool(re.match(r'^(Art\.\s*\d+|§\s*\d+)', p_clean, re.IGNORECASE))
        
        if is_title and len(p_clean) < 120:
            blocks.append(f'<h2 class="reading-section-title">{p_escaped}</h2>')
        elif is_article:
            blocks.append(f'<h3>{p_escaped}</h3>')
        else:
            blocks.append(f'<div class="reading-block"><p>{p_escaped}</p></div>')
        
    if not blocks:
        p_escaped = html.escape(text.strip())
        blocks.append(f'<div class="reading-block"><p>{p_escaped}</p></div>')
            
    return blocks

def split_html_into_blocks(html_content: str) -> list[str]:
    """Divide o HTML em blocos individuais sem perder nenhum texto intermediário fora de tags."""
    pattern = r'(<div class="reading-block[^>]*>.*?</div>|<h2 class="reading-section-title">.*?</h2>|<h3>.*?</h3>)'
    
    blocks = []
    last_end = 0
    for match in re.finditer(pattern, html_content, re.DOTALL):
        start, end = match.span()
        # Se houver texto entre o fim do último bloco e o início do atual, captura e envelopa em card comum
        inter_text = html_content[last_end:start].strip()
        if inter_text:
            # Remove tags parciais ou soltas que possam quebrar a renderização
            clean_inter = re.sub(r'</?(div|p)[^>]*>', '', inter_text).strip()
            if clean_inter:
                blocks.append(f'<div class="reading-block"><p>{clean_inter}</p></div>')
        
        # Adiciona o bloco casado
        blocks.append(match.group(0).strip())
        last_end = end
        
    # Se houver texto restante após o último bloco casado
    remaining_text = html_content[last_end:].strip()
    if remaining_text:
        clean_remaining = re.sub(r'</?(div|p)[^>]*>', '', remaining_text).strip()
        if clean_remaining:
            blocks.append(f'<div class="reading-block"><p>{clean_remaining}</p></div>')
    
    # Mescla blocos curtos (<=7 palavras) com o próximo, exceto enumerações e linhas com dois-pontos
    merged = []
    for b in blocks:
        text_only = re.sub(r'<[^>]+>', '', b).strip()
        words = text_only.split()
        is_short = len(words) <= 7
        is_enumeration = bool(re.match(r'^[IVXLCDM]+\s+[-–—]|^[a-z]\)\s', text_only))
        ends_with_colon = text_only.rstrip().endswith(':')
        
        if is_short and not is_enumeration and not ends_with_colon and merged:
            prev_text = re.sub(r'<[^>]+>', '', merged[-1]).strip()
            merged[-1] = f'<div class="reading-block"><p>{prev_text} {text_only}</p></div>'
        else:
            merged.append(b)
    
    # Converte h2 com mais de 7 palavras em bloco de leitura comum (título falso)
    converted = []
    for b in merged:
        if b.startswith('<h2'):
            text_only = re.sub(r'<[^>]+>', '', b).strip()
            if len(text_only.split()) > 7:
                b = f'<div class="reading-block"><p>{text_only}</p></div>'
        converted.append(b)
    
    # Se nenhum bloco foi casado de forma alguma, faz o split por quebras de linha duplas
    if not converted:
        converted = [f'<div class="reading-block"><p>{p.strip()}</p></div>' for p in html_content.split('\n\n') if p.strip()]
            
    return [b.strip() for b in converted if b.strip()]

def normalize_text_for_fidelity(text: str) -> str:
    # Decode HTML entities
    text = html.unescape(text)
    # Remove HTML badges first
    text = re.sub(r'<span class="badge">[^<]*</span>', '', text, flags=re.IGNORECASE)
    # Remove all HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Convert to lowercase
    text = text.lower()
    # Replace common accented characters
    replacements = {
        'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
        'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
        'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
        'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
        'ç': 'c', 'ñ': 'n'
    }
    for char, replacement in replacements.items():
        text = text.replace(char, replacement)
    # Keep only alphanumeric characters (a-z, 0-9)
    text = re.sub(r'[^a-z0-9]', '', text)
    return text

def validate_fidelity(raw_text: str, blocks: list[str]) -> bool:
    if not blocks:
        return False
    full_html = " ".join(blocks)
    norm_raw = normalize_text_for_fidelity(raw_text)
    norm_html = normalize_text_for_fidelity(full_html)
    
    if len(norm_raw) < 15:
        return True
        
    from difflib import SequenceMatcher
    ratio = SequenceMatcher(None, norm_raw, norm_html).ratio()
    print(f"[Fidelity Validator] Proporção de correspondência: {ratio:.4f} (Raw len: {len(norm_raw)}, HTML len: {len(norm_html)})")
    
    return ratio >= 0.98

async def organize_text_via_groq(raw_text: str, max_attempts: int = 5) -> list[str] | None:
    """Tenta estruturar o texto do PDF via Groq. Retorna os blocos ou None em caso de erro."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT}
    ]
    user_prompt = (
        "Aplicando as regras do sistema, estruture o texto abaixo em blocos HTML. "
        "IMPORTANTE: NÃO use <h2> para texto longo. <h2> é só para títulos de até 7 palavras. "
        "Use <div class=\"reading-block\"> para parágrafos comuns.\n\n"
        f"Texto:\n{raw_text}"
    )
    messages.append({"role": "user", "content": user_prompt})

    result = await _call_groq(messages, max_attempts)
    if result:
        blocks = split_html_into_blocks(result)
        if validate_fidelity(raw_text, blocks):
            return blocks
        else:
            print("[Fidelity Validator] Rejeitando resposta da IA por perda ou alteração de texto.")
        
    return None

def clean_html_for_tts(html_text: str) -> str:
    """Substitui tags de bloco por quebras de linha e limpa as demais tags HTML para evitar leitura incorreta."""
    text = html.unescape(html_text)
    text = re.sub(r'</?(div|p|h1|h2|h3|br)[^>]*>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\n+', '\n', text)
    return text.strip()

is_vercel = "VERCEL" in os.environ

dist_path = Path(__file__).parent / "frontend" / "dist"
use_dist = dist_path.exists() and not is_vercel

if use_dist:
    app.mount("/assets", StaticFiles(directory=dist_path / "assets"), name="assets")

@app.get("/")
async def serve_index():
    if is_vercel and (Path(__file__).parent / "index.html").exists():
        return FileResponse(Path(__file__).parent / "index.html")
    if use_dist and (dist_path / "index.html").exists():
        response = FileResponse(dist_path / "index.html")
    else:
        html_minimal = "<!DOCTYPE html><html><body><h1>Lumina Reader</h1><p>Frontend nao encontrado. Execute 'npm run build' em frontend/.</p></body></html>"
        return HTMLResponse(content=html_minimal)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

raw_sessions: Dict[str, list] = {}
structured_sessions: Dict[str, Dict[int, list]] = {}
processing_chunks = set()

async def pre_structure_session(session_id: str, chunks: list):
    """Estrutura os chunks em segundo plano sequencialmente usando Groq Llama."""
    for idx, chunk_content in enumerate(chunks):
        if session_id not in raw_sessions:
            break
        if session_id in structured_sessions and idx in structured_sessions[session_id]:
            continue
            
        try:
            # Delay reduzido para acelerar pré-carregamento; rate-limit do Groq é gerenciado com fallback de modelo
            await asyncio.sleep(1.5)
            
            # BLOQUEIO / EVITAR DUPLICIDADE: Verifica se outra tarefa (demanda) já está processando
            key = (session_id, idx)
            if key in processing_chunks:
                continue
                
            print(f"[Background] Estruturando chunk {idx+1}/{len(chunks)} sequencialmente...")
            
            processing_chunks.add(key)
            try:
                chunk_blocks = await organize_text_via_groq(chunk_content)
                if session_id not in structured_sessions:
                    structured_sessions[session_id] = {}
                if chunk_blocks:
                    if idx not in structured_sessions[session_id]:
                        structured_sessions[session_id][idx] = chunk_blocks
                    print(f"[Background] Chunk {idx+1}/{len(chunks)} concluído")
                else:
                    print(f"[Background] Chunk {idx+1}/{len(chunks)} falhou (ou não passou na validação). Salvando fallback local para evitar novas chamadas.")
                    fallback_blocks = organize_text_to_blocks(chunk_content)
                    if idx not in structured_sessions[session_id]:
                        structured_sessions[session_id][idx] = fallback_blocks
            finally:
                processing_chunks.discard(key)
                
        except Exception as e:
            print(f"[Background] Erro no chunk {idx}: {e}")

def clean_page_extracted_text(text: str) -> str:
    if not text:
        return ""
    
    # Normalize line endings and split into lines
    lines = [line.strip() for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    
    # Remove empty lines at start
    while lines and not lines[0]:
        lines.pop(0)
        
    # Check if first line is a page number or "Página X"
    if lines:
        first_line = lines[0]
        if re.match(r'^(?:\d+|pág\.\s*\d+|página\s*\d+(?:\s+de\s+\d+)?)$', first_line, re.IGNORECASE):
            lines.pop(0)
            
    # Check if first line matches the LDB header (e.g., "9Lei no 9.394/1996")
    if lines:
        first_line = lines[0]
        pattern_ldb = r'^\d*\s*(?:Lei\s+(?:nº|no|n\.º|n\.o)?\s*9\.?394/1996)\s*\d*$'
        if re.match(pattern_ldb, first_line, re.IGNORECASE):
            lines.pop(0)
            
    # Remove empty lines at end
    while lines and not lines[-1]:
        lines.pop()
        
    # Check if last line is a page number or "Página X"
    if lines:
        last_line = lines[-1]
        if re.match(r'^(?:\d+|pág\.\s*\d+|página\s*\d+(?:\s+de\s+\d+)?)$', last_line, re.IGNORECASE):
            lines.pop()
            
    # Check if last line matches the LDB header
    if lines:
        last_line = lines[-1]
        pattern_ldb = r'^\d*\s*(?:Lei\s+(?:nº|no|n\.º|n\.o)?\s*9\.?394/1996)\s*\d*$'
        if re.match(pattern_ldb, last_line, re.IGNORECASE):
            lines.pop()

    # Re-clean empty lines
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
        
    return '\n'.join(lines)

@app.post("/upload")
async def upload_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    session_id = str(uuid.uuid4())
    file_bytes = await file.read()
    print(f"[Upload] Recebido arquivo: {file.filename} ({len(file_bytes)} bytes)")

    reader = PdfReader(BytesIO(file_bytes))
    
    # Salva uma cópia local para fins de depuração
    try:
        debug_pdf_path = Path(__file__).parent / "uploaded_debug.pdf"
        with open(debug_pdf_path, "wb") as f_debug:
            f_debug.write(file_bytes)
        print(f"[Debug] Cópia do PDF salva em: {debug_pdf_path}")
    except Exception as e:
        print(f"[Debug] Erro ao salvar cópia do PDF: {e}")
    chunks = []
    
    # Extrai o texto organizando-o estritamente página por página (1 página = 1 chunk)
    for i, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        page_text = clean_page_extracted_text(page_text)
        if page_text:
            chunks.append(page_text)

    # Valida se conseguimos extrair texto
    if not chunks:
        print(f"[Upload] O texto extraído é nulo ou curto. Retornando aviso de PDF escaneado.")
        blocks = [
            "<div class=\"reading-block definition\">"
            "<h2>Aviso de Leitura</h2>"
            "<p><strong>Não conseguimos extrair texto legível deste PDF.</strong></p>"
            "<p>Parece que este arquivo contém apenas imagens digitalizadas/escaneadas ou não possui uma camada de texto acessível. "
            "Por favor, envie um PDF que contenha texto digital selecionável para que o leitor possa narrá-lo.</p>"
            "</div>"
        ]
        sessions[session_id] = blocks
        return JSONResponse(content={"session_id": session_id, "total_chunks": 1, "blocks": blocks})

    # Armazena chunks originais e inicia armazenamento estruturado
    raw_sessions[session_id] = chunks
    structured_sessions[session_id] = {}
    print(f"[Upload] PDF dividido em {len(chunks)} chunks de páginas. Iniciando estruturação...")
    
    # Processa o primeiro chunk (índice 0) imediatamente usando Groq
    first_chunk_blocks = await organize_text_via_groq(chunks[0])
    if not first_chunk_blocks:
        print("[Upload] Falha inicial do Groq para o chunk 0. Usando fallback local temporário.")
        first_chunk_blocks = organize_text_to_blocks(chunks[0])
    structured_sessions[session_id][0] = first_chunk_blocks
    
    # Inicia o processamento em segundo plano para os demais
    background_tasks.add_task(pre_structure_session, session_id, chunks)
    
    response_data = {
        "session_id": session_id,
        "total_chunks": len(chunks),
        "title": file.filename.replace('.pdf', '')
    }
    
    # Envia blocks na resposta se for exatamente 1 página
    if len(chunks) == 1:
        response_data["blocks"] = first_chunk_blocks
        
    return JSONResponse(content=response_data)

@app.get("/debug/session/{session_id}/raw/{chunk_index}")
async def get_session_raw_chunk(session_id: str, chunk_index: int):
    if session_id not in raw_sessions:
        return JSONResponse(status_code=404, content={"detail": "Sessão não encontrada."})
    chunks = raw_sessions[session_id]
    if chunk_index < 0 or chunk_index >= len(chunks):
        return JSONResponse(status_code=404, content={"detail": "Índice de chunk inválido."})
    return {"raw_text": chunks[chunk_index]}

@app.get("/session/{session_id}/chunk/{chunk_index}")
async def get_session_chunk(session_id: str, chunk_index: int):
    # Caso seja um mock, retorna todo o mock como único chunk
    if session_id.startswith("mock_"):
        if session_id not in sessions:
            return JSONResponse(status_code=404, content={"detail": "Mock de sessão não encontrado."})
        return {"blocks": sessions[session_id]}

    if session_id not in raw_sessions:
        return JSONResponse(status_code=404, content={"detail": "Sessão não encontrada."})
    
    chunks = raw_sessions[session_id]
    if chunk_index < 0 or chunk_index >= len(chunks):
        return JSONResponse(status_code=404, content={"detail": "Índice de chunk inválido."})
        
    # Se já estruturado, retorna imediatamente
    if session_id in structured_sessions and chunk_index in structured_sessions[session_id]:
        return {"blocks": structured_sessions[session_id][chunk_index]}
    
    # CONCORRÊNCIA: Se já está sendo processado por outra task (background ou outra requisição), aguarda
    key = (session_id, chunk_index)
    if key in processing_chunks:
        print(f"[Demand] Chunk {chunk_index} já está sendo processado por outra tarefa. Aguardando conclusão...")
        for _ in range(120): # máximo 60 segundos
            await asyncio.sleep(0.5)
            if session_id in structured_sessions and chunk_index in structured_sessions[session_id]:
                return {"blocks": structured_sessions[session_id][chunk_index]}
            if key not in processing_chunks:
                break
                
        # Re-checa se concluiu
        if session_id in structured_sessions and chunk_index in structured_sessions[session_id]:
            return {"blocks": structured_sessions[session_id][chunk_index]}
    
    # Processa sob demanda
    print(f"[Demand] Processando chunk {chunk_index} sob demanda com Groq...")
    chunk_content = chunks[chunk_index]
    
    processing_chunks.add(key)
    try:
        chunk_blocks = await organize_text_via_groq(chunk_content)
        if session_id not in structured_sessions:
            structured_sessions[session_id] = {}
        if chunk_blocks:
            structured_sessions[session_id][chunk_index] = chunk_blocks
            return {"blocks": chunk_blocks}
        else:
            print(f"[Demand] Falha no Groq (ou validação) para o chunk {chunk_index}. Retornando e salvando fallback local.")
            fallback_blocks = organize_text_to_blocks(chunk_content)
            structured_sessions[session_id][chunk_index] = fallback_blocks
            return {"blocks": fallback_blocks}
    finally:
        processing_chunks.discard(key)

@app.get("/mock-session/{mock_id}")
async def get_mock_session(mock_id: str):
    full_mock_id = f"mock_{mock_id}"
    if full_mock_id not in sessions:
        return JSONResponse(status_code=404, content={"detail": "Mock de sessão não encontrado."})
    
    title = "O Capital - Livro I"
    if mock_id == "acessibilidade":
        title = "Manual de Acessibilidade"
    elif mock_id == "design":
        title = "Design do Dia a Dia"
        
    return {
        "session_id": full_mock_id,
        "blocks": sessions[full_mock_id],
        "title": title
    }

@app.get("/stream-audio/{session_id}/{block_index}")
async def stream_audio(session_id: str, block_index: int, voice: str = "pt-BR-FranciscaNeural", chunk_index: int = 0):
    # Resolve os blocos da sessão
    session_blocks = []
    if session_id.startswith("mock_"):
        if session_id in sessions:
            session_blocks = sessions[session_id]
    else:
        if session_id in structured_sessions and chunk_index in structured_sessions[session_id]:
            session_blocks = structured_sessions[session_id][chunk_index]
            
    if not session_blocks:
        return JSONResponse(status_code=404, content={"detail": "Sessão ou chunk não estruturado ainda."})
    
    if block_index < 0 or block_index >= len(session_blocks):
        return JSONResponse(status_code=400, content={"detail": "Índice de bloco inválido."})
        
    block_html = session_blocks[block_index]
    # Remove as tags HTML do bloco para a narração limpa
    clean_text = clean_html_for_tts(block_html)
    
    if not clean_text or clean_text.isspace():
        async def empty_generator():
            yield b""
        return StreamingResponse(empty_generator(), media_type="audio/mpeg")

    voice_lower = voice.lower()
    edge_voice_id = "pt-BR-FranciscaNeural"
    
    # Mapeamento de vozes neurais da Microsoft
    if "francisca" in voice_lower:
        edge_voice_id = "pt-BR-FranciscaNeural"
    elif "antonio" in voice_lower:
        edge_voice_id = "pt-BR-AntonioNeural"
    elif "thalita" in voice_lower:
        edge_voice_id = "pt-BR-ThalitaMultilingualNeural"
    elif "duarte" in voice_lower:
        edge_voice_id = "pt-PT-DuarteNeural"
    elif "raquel" in voice_lower:
        edge_voice_id = "pt-PT-RaquelNeural"
    elif "ava" in voice_lower:
        edge_voice_id = "en-US-AvaNeural"
    elif "andrew" in voice_lower:
        edge_voice_id = "en-US-AndrewNeural"
    elif "alvaro" in voice_lower:
        edge_voice_id = "es-ES-AlvaroNeural"
    elif "elvira" in voice_lower:
        edge_voice_id = "es-ES-ElviraNeural"
    elif "-" in voice:
        edge_voice_id = voice

    async def edge_audio_generator():
        try:
            communicate = edge_tts.Communicate(clean_text, edge_voice_id)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
        except Exception as e:
            print(f"Erro ao transmitir áudio do Edge TTS (bloco {block_index}): {e}")
            
    return StreamingResponse(edge_audio_generator(), media_type="audio/mpeg")

# Catch-all para rotas não mapeadas da SPA React (quando o dist existir e não estiver no Vercel)
if use_dist:
    @app.get("/{rest_of_path:path}")
    async def serve_all(rest_of_path: str):
        fp = dist_path / rest_of_path
        if fp.exists() and fp.is_file():
            return FileResponse(fp)
        response = FileResponse(dist_path / "index.html")
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

