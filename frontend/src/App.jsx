import { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  Trash2, 
  ArrowLeft, 
  ArrowRight,
  Play, 
  Pause, 
  FastForward, 
  Rewind, 
  Volume2, 
  Settings, 
  Sparkles, 
  ChevronDown,
  Search,
  X,
  ChevronUp
} from 'lucide-react';
import './App.css';

// Default mock sessions in case backend mock endpoint is slow or unreachable
const defaultMockSessions = {
  capital: {
    title: 'O Capital - Livro I',
    blocks: [
      '<h2 class="reading-section-title">Seção 1: Mercadoria e Dinheiro</h2>',
      '<div class="reading-block definition"><p><span class="badge">Conceito</span><strong>Mercadoria:</strong> É o objeto externo, uma coisa que, por suas propriedades, satisfaz necessidades humanas.</p></div>',
      '<div class="reading-block"><p>A utilidade de uma coisa faz dela um <strong>valor de uso</strong>. Mas esta utilidade não flutua no ar. Condicionada pelas propriedades do corpo da mercadoria, ela não existe sem ele.</p></div>',
      '<div class="reading-block"><p><strong>O Fetiche da Mercadoria:</strong> Um fenômeno onde as relações sociais entre pessoas são mascaradas por relações entre <strong>coisas</strong> e <strong>valores de troca</strong>.</p></div>',
      '<div class="reading-block bordered"><p><strong>1. Valor de Uso:</strong> Refere-se à utilidade de um objeto. O corpo da própria mercadoria, como o ferro, o trigo, o diamante, etc.</p></div>',
      '<div class="reading-block bordered"><p><strong>2. Valor de Troca:</strong> A proporção em que valores de uso de uma espécie se trocam por outros, relação que muda constantemente.</p></div>'
    ]
  },
  acessibilidade: {
    title: 'Manual de Acessibilidade',
    blocks: [
      '<h2 class="reading-section-title">Acessibilidade Digital</h2>',
      '<div class="reading-block definition"><p><span class="badge">Importante</span><strong>Acessibilidade:</strong> É a garantia de que qualquer pessoa, independentemente de suas capacidades físicas ou cognitivas, consiga perceber, compreender, navegar e interagir com produtos digitais.</p></div>',
      '<div class="reading-block"><p>Desenvolver com acessibilidade significa remover barreiras na web. Isso beneficia não apenas pessoas com deficiências permanentes, mas também aquelas com limitações temporárias ou situacionais.</p></div>',
      '<div class="reading-block bordered"><p><strong>Regra de Ouro:</strong> Sempre forneça textos alternativos para imagens, garanta contraste de cores adequado e permita navegação completa via teclado.</p></div>'
    ]
  },
  design: {
    title: 'Design do Dia a Dia',
    blocks: [
      '<h2 class="reading-section-title">O Design das Coisas</h2>',
      '<div class="reading-block definition"><p><span class="badge">Teoria</span><strong>Affordance:</strong> É a relação entre as propriedades de um objeto físico e as capacidades do agente que determinam como o objeto pode ser usado.</p></div>',
      '<div class="reading-block"><p>Quando as coisas simples precisam de fotos, instruções ou avisos, o design falhou. Um bom design deve ser intuitivo e comunicar sua função naturalmente.</p></div>',
      '<div class="reading-block bordered"><p><strong>Feedback:</strong> O princípio de enviar de volta informações sobre qual ação foi realizada e qual resultado foi alcançado. É crucial para o controle e aprendizado.</p></div>'
    ]
  }
};

const getBackendUrl = () => {
  const host = window.location.hostname;
  return `http://${host}:8000`;
};

// Clean HTML for TTS
const cleanHtmlForTts = (html) => {
  let text = html;
  // Replace block element tags with newlines
  text = text.replace(/<\/?(div|p|h1|h2|h3|br)[^>]*>/g, '\n');
  // Strip all HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Collapse duplicate newlines
  text = text.replace(/\n+/g, '\n');
  // Decode common HTML entities
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  return text.trim();
};

const generateSessionId = (sessionId) => {
  return sessionId || `session_${Date.now()}`;
};

export default function App() {
  // Navigation & Views
  const [view, setView] = useState('home');
  const [loadingText, setLoadingText] = useState('');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  
  // App States
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [isVoiceDropdownOpen, setIsVoiceDropdownOpen] = useState(false);
  const [isSpeedDropdownOpen, setIsSpeedDropdownOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('lumina_theme') || 'original');
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef(null);

  // References to bypass closures in event handlers
  const currentPageIndexRef = useRef(0);
  const currentBlockIndexRef = useRef(0);
  const blocksRef = useRef([]);
  const audioRef = useRef(null);

  // Keep references synced
  useEffect(() => {
    currentPageIndexRef.current = currentPageIndex;
  }, [currentPageIndex]);

  useEffect(() => {
    currentBlockIndexRef.current = currentBlockIndex;
  }, [currentBlockIndex]);

  // Helper to resolve current page blocks
  const getCurrentPageBlocks = () => {
    if (!activeSession) return [];
    if (activeSession.pages) {
      return activeSession.pages[currentPageIndex] || [];
    }
    // Backward compatibility for old saved sessions that only have .blocks
    return activeSession.blocks || [];
  };

  const currentPageBlocks = getCurrentPageBlocks();

  useEffect(() => {
    blocksRef.current = currentPageBlocks;
  }, [currentPageBlocks]);

  // Initial setup: Load sessions and system voices
  useEffect(() => {
    loadSystemVoices();
    loadSessionsFromLocalStorage();
  }, []);

  // Pre-fetch next pages in the background to provide seamless reading experience
  useEffect(() => {
    if (!activeSession || !activeSession.id || activeSession.id.startsWith('mock_')) return;
    
    const prefetchPages = async () => {
      const backendUrl = getBackendUrl();
      // Pre-fetch the next 3 pages
      for (let offset = 1; offset <= 3; offset++) {
        const pageIndex = currentPageIndex + offset;
        if (pageIndex >= (activeSession.totalChunks || 1)) break;
        if (activeSession.pages && activeSession.pages[pageIndex]) continue;
        
        try {
          console.log(`[Prefetch] Carregando página ${pageIndex + 1}/${activeSession.totalChunks} em cache...`);
          const response = await fetch(`${backendUrl}/session/${activeSession.id}/chunk/${pageIndex}`);
          if (!response.ok) throw new Error("Prefetch failed");
          
          const data = await response.json();
          if (data.blocks && data.blocks.length > 0) {
            setActiveSession(prev => {
              if (!prev || prev.id !== activeSession.id) return prev;
              const updatedPages = { ...prev.pages, [pageIndex]: data.blocks };
              const loaded = Math.max(prev.loadedChunks || 1, pageIndex + 1);
              const updatedSession = { ...prev, pages: updatedPages, loadedChunks: loaded };
              
              setSessions(prevList => {
                const updatedList = prevList.map(s => s.id === prev.id ? updatedSession : s);
                localStorage.setItem('lumina_reader_sessions', JSON.stringify(updatedList));
                return updatedList;
              });
              
              return updatedSession;
            });
            console.log(`[Prefetch] Página ${pageIndex + 1} em cache com sucesso!`);
          }
        } catch (err) {
          console.warn(`[Prefetch] Erro na página ${pageIndex + 1}:`, err);
          break;
        }
      }
    };
    
    prefetchPages();
  }, [activeSession, currentPageIndex]);

  // Effect to register system voices changes
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const handleVoicesChanged = () => {
        loadSystemVoices();
      };
      window.speechSynthesis.onvoiceschanged = handleVoicesChanged;
      // Initial trigger
      handleVoicesChanged();
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  function loadSystemVoices() {
    const edgeVoices = [
      { id: 'pt-BR-FranciscaNeural', name: 'Francisca (Feminino - Microsoft Neural)', provider: 'microsoft', lang: 'pt-BR' },
      { id: 'pt-BR-AntonioNeural', name: 'Antonio (Masculino - Microsoft Neural)', provider: 'microsoft', lang: 'pt-BR' },
      { id: 'pt-BR-ThalitaMultilingualNeural', name: 'Thalita (Feminino - Microsoft Neural)', provider: 'microsoft', lang: 'pt-BR' },
      { id: 'pt-PT-RaquelNeural', name: 'Raquel (Feminino - Portugal Neural)', provider: 'microsoft', lang: 'pt-PT' },
      { id: 'pt-PT-DuarteNeural', name: 'Duarte (Masculino - Portugal Neural)', provider: 'microsoft', lang: 'pt-PT' },
      { id: 'en-US-AvaNeural', name: 'Ava (Feminino - Inglês Neural)', provider: 'microsoft', lang: 'en-US' },
      { id: 'en-US-AndrewNeural', name: 'Andrew (Masculino - Inglês Neural)', provider: 'microsoft', lang: 'en-US' },
      { id: 'es-ES-ElviraNeural', name: 'Elvira (Feminino - Espanhol Neural)', provider: 'microsoft', lang: 'es-ES' },
      { id: 'es-ES-AlvaroNeural', name: 'Alvaro (Masculino - Espanhol Neural)', provider: 'microsoft', lang: 'es-ES' }
    ];

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const sysVoices = window.speechSynthesis.getVoices();
      const formatted = sysVoices
        .filter(v => v.lang.toLowerCase().includes('pt') || v.lang.toLowerCase().includes('en') || v.lang.toLowerCase().includes('es'))
        .map(v => ({
          id: v.name,
          name: `${v.name} (Local)`,
          provider: 'system',
          lang: v.lang
        }));
      
      const combined = [...edgeVoices, ...formatted];
      setVoices(combined);
      if (combined.length > 0) {
        setSelectedVoice(prev => {
          if (prev) {
            const exists = combined.find(v => v.id === prev.id);
            if (exists) return exists;
          }
          return combined.find(v => v.id === 'pt-BR-FranciscaNeural') || combined[0];
        });
      }
    } else {
      setVoices(edgeVoices);
      setSelectedVoice(prev => {
        if (prev) {
          const exists = edgeVoices.find(v => v.id === prev.id);
          if (exists) return exists;
        }
        return edgeVoices.find(v => v.id === 'pt-BR-FranciscaNeural') || edgeVoices[0];
      });
    }
  }

  function loadSessionsFromLocalStorage() {
    try {
      const saved = localStorage.getItem('lumina_reader_sessions');
      if (saved) {
        setSessions(JSON.parse(saved));
      } else {
        // Load defaults if empty, adapted for pages structure
        const initial = [
          { id: 'mock_capital', title: 'O Capital - Livro I', progress: 75, date: 'Ontem', pages: { 0: defaultMockSessions.capital.blocks }, totalChunks: 1, loadedChunks: 1, currentPageIndex: 0 },
          { id: 'mock_acessibilidade', title: 'Manual de Acessibilidade', progress: 32, date: '10 de Jun', pages: { 0: defaultMockSessions.acessibilidade.blocks }, totalChunks: 1, loadedChunks: 1, currentPageIndex: 0 },
          { id: 'mock_design', title: 'Design do Dia a Dia', progress: 95, date: '05 de Jun', pages: { 0: defaultMockSessions.design.blocks }, totalChunks: 1, loadedChunks: 1, currentPageIndex: 0 }
        ];
        setSessions(initial);
        localStorage.setItem('lumina_reader_sessions', JSON.stringify(initial));
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Upload Logic
  const handleUploadFile = async (file) => {
    if (!file || file.type !== 'application/pdf') {
      alert('Por favor, envie apenas arquivos PDF.');
      return;
    }

    setLoadingText('Aguarde, processando o arquivo PDF...');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Falha no upload do arquivo');
      }

      const data = await response.json();
      let blocks = data.blocks;
      const totalChunks = data.total_chunks || 1;
      const sessionId = data.session_id;

      if (!blocks && sessionId) {
        // Fetch chunk 0 immediately
        const chunkResp = await fetch(`${backendUrl}/session/${sessionId}/chunk/0`);
        if (chunkResp.ok) {
          const chunkData = await chunkResp.json();
          blocks = chunkData.blocks;
        }
      }

      if (blocks && blocks.length > 0) {
        const title = file.name.replace(/\.[^/.]+$/, "");
        const newSession = {
          id: generateSessionId(sessionId),
          title: title,
          progress: 0,
          date: 'Hoje',
          pages: { 0: blocks },
          totalChunks: totalChunks,
          loadedChunks: 1,
          currentPageIndex: 0
        };

        const updated = [newSession, ...sessions.filter(s => s.id !== newSession.id)];
        setSessions(updated);
        localStorage.setItem('lumina_reader_sessions', JSON.stringify(updated));

        // Open session
        openSession(newSession);
      } else {
        alert('Nenhum conteúdo legível encontrado no PDF.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao processar o arquivo PDF. Verifique se o backend está rodando no computador.');
    } finally {
      setLoadingText('');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleUploadFile(files[0]);
    }
  };

  const openSession = (session) => {
    setActiveSession(session);
    setCurrentBlockIndex(0);
    setCurrentPageIndex(session.currentPageIndex || 0);
    setView('reader');
    setIsPlaying(false);
  };

  const deleteSession = (id, e) => {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    localStorage.setItem('lumina_reader_sessions', JSON.stringify(updated));
  };

  // Playback Control Logic
  const playBlock = async (index) => {
    if (!activeSession) return;
    const blocks = getCurrentPageBlocks();
    if (blocks.length === 0 || index < 0 || index >= blocks.length) return;
    
    setCurrentBlockIndex(index);
    const rawBlock = blocks[index];
    const textToSpeak = cleanHtmlForTts(rawBlock);

    try {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch (err) {
          console.error(err);
        }
      }

      // Check if we should use system speech synthesis:
      const useSystemSpeech = selectedVoice && selectedVoice.provider === 'system';

      if (useSystemSpeech) {
        if (!('speechSynthesis' in window)) {
          alert("Seu navegador não suporta narração de voz nativa.");
          return;
        }

        window.speechSynthesis.cancel();
        setIsPlaying(true);

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = 'pt-BR';
        utterance.rate = speed;

        const sysVoices = window.speechSynthesis.getVoices();
        const matchedVoice = sysVoices.find(v => v.name === selectedVoice.id);
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        } else {
          const ptVoice = sysVoices.find(v => v.lang.toLowerCase().includes('pt'));
          if (ptVoice) {
            utterance.voice = ptVoice;
          }
        }

        utterance.onend = () => {
          setIsPlaying(false);
          const nextIndex = currentBlockIndexRef.current + 1;
          const currentBlocks = blocksRef.current;
          if (nextIndex < currentBlocks.length) {
            playBlock(nextIndex);
          } else {
            handlePageEnd();
          }
        };

        utterance.onerror = (err) => {
          console.error("SpeechSynthesis error:", err);
          setIsPlaying(false);
        };

        audioRef.current = {
          pause: () => {
            window.speechSynthesis.pause();
            setIsPlaying(false);
          },
          play: () => {
            window.speechSynthesis.resume();
            setIsPlaying(true);
          },
          playbackRate: speed
        };

        window.speechSynthesis.speak(utterance);

        const progressPercent = Math.round(((currentPageIndex + (index + 1) / blocks.length) / activeSession.totalChunks) * 100);
        updateSessionProgress(activeSession.id, progressPercent);
        return;
      }

      // Play via backend stream-audio for Microsoft neural voices
      setIsPlaying(true);
      const backendUrl = getBackendUrl();
      const voiceId = selectedVoice ? selectedVoice.id : 'pt-BR-FranciscaNeural';
      const audioUrl = `${backendUrl}/stream-audio/${activeSession.id}/${index}?voice=${voiceId}&chunk_index=${currentPageIndex}`;
      
      const audioObj = new Audio(audioUrl);
      audioObj.playbackRate = speed;

      // Event Listeners
      audioObj.addEventListener('ended', () => {
        setIsPlaying(false);
        const nextIndex = currentBlockIndexRef.current + 1;
        const currentBlocks = blocksRef.current;
        if (nextIndex < currentBlocks.length) {
          playBlock(nextIndex);
        } else {
          handlePageEnd();
        }
      });

      audioObj.addEventListener('play', () => {
        setIsPlaying(true);
      });

      audioObj.addEventListener('pause', () => {
        setIsPlaying(false);
      });

      audioObj.addEventListener('error', (err) => {
        console.error("Audio playback error:", err);
        setIsPlaying(false);
        alert("Não foi possível carregar a narração de voz neural. Verifique se o servidor backend está rodando no computador.");
      });

      audioRef.current = audioObj;
      audioObj.play().catch(err => {
        console.error("Audio play failed:", err);
        setIsPlaying(false);
      });

      const progressPercent = Math.round(((currentPageIndex + (index + 1) / blocks.length) / activeSession.totalChunks) * 100);
      updateSessionProgress(activeSession.id, progressPercent);
    } catch (e) {
      console.error(e);
      const errMsg = e ? (e.message || e.description || String(e)) : "Erro desconhecido";
      alert("Erro ao reproduzir áudio: " + errMsg);
      setIsPlaying(false);
    }
  };

  const handlePageEnd = () => {
    if (currentPageIndex < (activeSession.totalChunks || 1) - 1) {
      console.log("[Playback] Fim da página. Avançando para a próxima...");
      handlePageChange(currentPageIndex + 1, true);
    } else {
      updateSessionProgress(activeSession.id, 100);
    }
  };

  const handlePageChange = async (newPageIndex, autoPlayFirstBlock = false) => {
    if (!activeSession || newPageIndex < 0 || newPageIndex >= (activeSession.totalChunks || 1)) return;
    
    // Stop playing current block before switching page
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (err) {
        console.error(err);
      }
    }
    
    // 1. If page is already loaded, switch instantly
    if (activeSession.pages && activeSession.pages[newPageIndex]) {
      setCurrentPageIndex(newPageIndex);
      setCurrentBlockIndex(0);
      updateSessionPageIndex(activeSession.id, newPageIndex);
      
      if (autoPlayFirstBlock) {
        setTimeout(() => playBlock(0), 100);
      }
      return;
    }
    
    // 2. Otherwise load on demand
    setLoadingText('Organizando próxima página...');
    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/session/${activeSession.id}/chunk/${newPageIndex}`);
      if (!response.ok) throw new Error("Failed to load page");
      
      const data = await response.json();
      if (data.blocks && data.blocks.length > 0) {
        const updatedPages = { ...activeSession.pages, [newPageIndex]: data.blocks };
        const updatedSession = {
          ...activeSession,
          pages: updatedPages,
          loadedChunks: Math.max(activeSession.loadedChunks || 1, newPageIndex + 1),
          currentPageIndex: newPageIndex
        };
        
        setActiveSession(updatedSession);
        setCurrentPageIndex(newPageIndex);
        setCurrentBlockIndex(0);
        
        setSessions(prev => {
          const updatedList = prev.map(s => s.id === activeSession.id ? updatedSession : s);
          localStorage.setItem('lumina_reader_sessions', JSON.stringify(updatedList));
          return updatedList;
        });
        
        if (autoPlayFirstBlock) {
          setTimeout(() => playBlock(0), 100);
        }
      }
    } catch (err) {
      console.error("Error loading page change:", err);
      alert("Não foi possível carregar a página. Tente novamente.");
    } finally {
      setLoadingText('');
    }
  };

  const handlePageChangePrevious = async () => {
    if (currentPageIndex > 0) {
      const prevIdx = currentPageIndex - 1;
      
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch (err) {
          console.error(err);
        }
      }
      
      if (activeSession.pages && activeSession.pages[prevIdx]) {
        setCurrentPageIndex(prevIdx);
        const prevBlocks = activeSession.pages[prevIdx];
        setCurrentBlockIndex(prevBlocks.length - 1);
        updateSessionPageIndex(activeSession.id, prevIdx);
        
        setTimeout(() => playBlock(prevBlocks.length - 1), 100);
        return;
      }
      
      setLoadingText('Carregando página anterior...');
      try {
        const backendUrl = getBackendUrl();
        const response = await fetch(`${backendUrl}/session/${activeSession.id}/chunk/${prevIdx}`);
        if (response.ok) {
          const data = await response.json();
          if (data.blocks && data.blocks.length > 0) {
            const updatedPages = { ...activeSession.pages, [prevIdx]: data.blocks };
            const updatedSession = {
              ...activeSession,
              pages: updatedPages,
              loadedChunks: Math.max(activeSession.loadedChunks || 1, prevIdx + 1),
              currentPageIndex: prevIdx
            };
            setActiveSession(updatedSession);
            setCurrentPageIndex(prevIdx);
            setCurrentBlockIndex(data.blocks.length - 1);
            
            setSessions(prevList => {
              const updatedList = prevList.map(s => s.id === activeSession.id ? updatedSession : s);
              localStorage.setItem('lumina_reader_sessions', JSON.stringify(updatedList));
              return updatedList;
            });
            
            setTimeout(() => playBlock(data.blocks.length - 1), 100);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingText('');
      }
    }
  };

  const updateSessionPageIndex = (id, pageIndex) => {
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, currentPageIndex: pageIndex } : s);
      localStorage.setItem('lumina_reader_sessions', JSON.stringify(updated));
      return updated;
    });
    setActiveSession(prev => prev && prev.id === id ? { ...prev, currentPageIndex: pageIndex } : prev);
  };

  const updateSessionProgress = (id, progressPercent) => {
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, progress: Math.max(s.progress, progressPercent) } : s);
      localStorage.setItem('lumina_reader_sessions', JSON.stringify(updated));
      return updated;
    });
  };

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    } else {
      playBlock(currentBlockIndex);
    }
  };

  const advanceNextBlock = () => {
    if (currentBlockIndex < currentPageBlocks.length - 1) {
      playBlock(currentBlockIndex + 1);
    } else if (currentPageIndex < (activeSession.totalChunks || 1) - 1) {
      handlePageChange(currentPageIndex + 1, true);
    }
  };

  const goToPreviousBlock = () => {
    if (currentBlockIndex > 0) {
      playBlock(currentBlockIndex - 1);
    } else if (currentPageIndex > 0) {
      handlePageChangePrevious();
    }
  };

  const changeSpeed = (newSpeed) => {
    setSpeed(newSpeed);
    setIsSpeedDropdownOpen(false);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  const changeVoice = (voice) => {
    setSelectedVoice(voice);
    setIsVoiceDropdownOpen(false);
    if (isPlaying) {
      setTimeout(() => playBlock(currentBlockIndex), 100);
    }
  };

  // Theme management
  useEffect(() => {
    const root = document.documentElement;
    root.className = `theme-${theme}`;
    localStorage.setItem('lumina_theme', theme);
    // Apply font-family and font-weight from theme variables
    const fontBody = getComputedStyle(root).getPropertyValue('--font-body').trim();
    const fontWeight = getComputedStyle(root).getPropertyValue('--font-body-weight').trim();
    document.body.style.fontFamily = fontBody || "'IBM Plex Sans', sans-serif";
    document.body.style.fontWeight = fontWeight || '400';
  }, [theme]);

  const changeTheme = (newTheme) => {
    setTheme(newTheme);
    setIsThemeDropdownOpen(false);
  };

  const themeNames = {
    original: 'Original',
    quiet: 'Quiet',
    paper: 'Paper',
    bold: 'Bold',
    calm: 'Calm',
    focus: 'Focus'
  };

  const themeIcons = {
    original: '☀️',
    quiet: '🌙',
    paper: '📄',
    bold: '⬛',
    calm: '📖',
    focus: '🎯'
  };

  // Search logic
  const toggleSearch = () => {
    setIsSearchOpen(prev => !prev);
    if (!isSearchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
      setSearchResults([]);
      setCurrentMatchIndex(0);
    }
  };

  const performSearch = (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setCurrentMatchIndex(0);
      return;
    }
    const q = query.toLowerCase();
    const results = [];
    currentPageBlocks.forEach((blockHtml, index) => {
      const text = blockHtml.replace(/<[^>]+>/g, '').toLowerCase();
      if (text.includes(q)) {
        results.push(index);
      }
    });
    setSearchResults(results);
    setCurrentMatchIndex(results.length > 0 ? 0 : 0);
    if (results.length > 0) {
      scrollToBlock(results[0]);
    }
  };

  const scrollToBlock = (blockIndex) => {
    const el = document.querySelector(`[data-block-index="${blockIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const goToNextMatch = () => {
    if (searchResults.length > 0) {
      const next = (currentMatchIndex + 1) % searchResults.length;
      setCurrentMatchIndex(next);
      scrollToBlock(searchResults[next]);
    }
  };

  const goToPrevMatch = () => {
    if (searchResults.length > 0) {
      const prev = (currentMatchIndex - 1 + searchResults.length) % searchResults.length;
      setCurrentMatchIndex(prev);
      scrollToBlock(searchResults[prev]);
    }
  };

  const highlightSearchText = (html, blockIndex) => {
    if (!searchQuery.trim() || !searchResults.includes(blockIndex)) return html;
    const matchIdx = searchResults.indexOf(blockIndex);
    const isActiveMatch = matchIdx === currentMatchIndex;
    const text = html.replace(/<[^>]+>/g, '');
    const q = searchQuery;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const highlighted = text.replace(regex, `<mark class="search-mark ${isActiveMatch ? 'search-mark-active' : ''}">$1</mark>`);
    return highlighted;
  };

  // Auto-scroll logic to keep the highlighted card in the center of screen
  useEffect(() => {
    if (view === 'reader') {
      const highlighted = document.querySelector('.clickable-block.highlight');
      if (highlighted) {
        highlighted.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }, [currentBlockIndex, view]);

  return (
    <div className="view-container">
      {/* Upload/Processing Overlay spinner */}
      {loadingText && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <div className="loading-text">{loadingText}</div>
        </div>
      )}

      {/* ================= VIEW 1: HOME VIEW ================= */}
      {view === 'home' && (
        <main className="home-main">
          {/* Header */}
          <section className="welcome-section">
            <h1>Lumina Reader</h1>
            <p>Sua leitura formatada e narrada por vozes inteligentes neurais.</p>
          </section>

          {/* Upload Zone */}
          <section className="upload-section">
            <div 
              className={`upload-zone ${isDragging ? 'dragover' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input').click()}
            >
              <div className="upload-icon-wrapper">
                <Upload className="upload-icon-symbol" />
              </div>
              <h3>Upload PDF</h3>
              <p>Arraste seu PDF aqui ou clique para selecionar</p>
              <button className="btn">Selecionar PDF</button>
              <input 
                id="file-input" 
                type="file" 
                accept=".pdf" 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files.length > 0) handleUploadFile(e.target.files[0]);
                }}
              />
            </div>
          </section>

          {/* Recent sessions */}
          <section className="recent-section">
            <div className="recent-header">
              <h2>Leituras Recentes</h2>
            </div>
            <div className="recent-list">
              {sessions.map((session) => (
                <div key={session.id} className="recent-item" onClick={() => openSession(session)}>
                  <div className="recent-icon-wrapper">
                    <FileText className="recent-icon" />
                  </div>
                  <div className="recent-info">
                    <div className="recent-title">{session.title}</div>
                    <div className="progress-bar-container">
                      <div className="progress-bar-fill" style={{ width: `${session.progress}%` }}></div>
                    </div>
                  </div>
                  <span className="recent-percentage">{session.progress}%</span>
                  <button className="icon-btn" style={{ marginLeft: '12px' }} onClick={(e) => deleteSession(session.id, e)}>
                    <Trash2 size={16} style={{ color: '#ef4444' }} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {/* ================= VIEW 2: READER VIEW ================= */}
      {view === 'reader' && activeSession && (
        <>
          {/* Header */}
          <header className="reader-header">
            <button className="icon-btn" onClick={() => setView('home')}>
              <ArrowLeft />
            </button>
            <div className="logo-group" style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '40%' }}>
              <div className="logo" style={{ margin: 0 }}>{activeSession.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', fontWeight: 600 }}>
                Página {currentPageIndex + 1} de {activeSession.totalChunks || 1}
              </div>
            </div>
            <div className="header-actions">
              <div className="page-nav-buttons">
                <button 
                  className="page-nav-btn" 
                  disabled={currentPageIndex === 0} 
                  onClick={() => handlePageChange(currentPageIndex - 1)}
                  title="Página Anterior"
                >
                  <ArrowLeft size={18} />
                  <span>Anterior</span>
                </button>
                <button 
                  className="page-nav-btn page-nav-btn-next" 
                  disabled={currentPageIndex === (activeSession.totalChunks || 1) - 1} 
                  onClick={() => handlePageChange(currentPageIndex + 1)}
                  title="Próxima Página"
                >
                  <span>Próxima</span>
                  <ArrowRight size={18} />
                </button>
              </div>
              <button className="icon-btn search-toggle-btn" onClick={toggleSearch} title="Pesquisar">
                <Search size={18} />
              </button>
            </div>
          </header>
          {/* Search Bar */}
          {isSearchOpen && (
            <div className="search-bar">
              <Search size={16} className="search-bar-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                placeholder="Pesquisar nesta página..."
                value={searchQuery}
                onChange={(e) => performSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.shiftKey ? goToPrevMatch() : goToNextMatch();
                  }
                }}
              />
              {searchQuery && (
                <div className="search-matches">
                  <span className="search-match-count">
                    {searchResults.length > 0
                      ? `${currentMatchIndex + 1} de ${searchResults.length}`
                      : '0 resultados'}
                  </span>
                  <button className="search-nav-btn" onClick={goToPrevMatch} disabled={searchResults.length === 0}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="search-nav-btn" onClick={goToNextMatch} disabled={searchResults.length === 0}>
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}
              <button className="icon-btn search-close-btn" onClick={toggleSearch}>
                <X size={16} />
              </button>
            </div>
          )}

          {/* Reader view body */}
          <main className="reader-main">
            <div className="reader-content-inner">
              <div className="info-banner">
                <Sparkles className="info-banner-icon" />
                <span>Toque sobre qualquer card para ouvi-lo em voz alta.</span>
              </div>
              <div id="text-content">
                {currentPageBlocks.map((blockHtml, index) => {
                  const isCurrent = index === currentBlockIndex;
                  const isTitle = blockHtml.includes('reading-section-title');
                  
                  // Simple check for cards formatting types
                  let cardType = 'normal';
                  if (blockHtml.includes('definition')) cardType = 'definition';
                  else if (blockHtml.includes('warning')) cardType = 'warning';
                  else if (blockHtml.includes('quote')) cardType = 'quote';
                  else if (blockHtml.includes('bordered')) cardType = 'bordered';

                  // Extrating text to display cleanly
                  let cleanText = blockHtml;
                  cleanText = cleanText.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
                  cleanText = cleanText.replace(/^<h2[^>]*>/, '').replace(/<\/h2>$/, '');
                  cleanText = cleanText.replace(/<span class="badge">[^<]+<\/span>/, '');
                  cleanText = cleanText.replace(/<\/?p[^>]*>/g, '');

                  // Apply search highlighting
                  const isSearchMatch = searchResults.includes(index);
                  let displayHtml = cleanText;
                  if (isSearchOpen && searchQuery.trim()) {
                    displayHtml = highlightSearchText(cleanText, index);
                  }

                  // Extracting badge text
                  const badgeRegex = /<span class="badge">([^<]+)<\/span>/;
                  const badgeMatch = blockHtml.match(badgeRegex);
                  const badgeText = badgeMatch ? badgeMatch[1] : null;

                  if (isTitle) {
                    return (
                      <h2 
                        key={index} 
                        data-block-index={index}
                        className={`reading-section-title clickable-block ${isCurrent ? 'highlight' : ''} ${isSearchMatch ? 'has-search-match' : ''}`}
                        onClick={() => playBlock(index)}
                        dangerouslySetInnerHTML={{ __html: displayHtml }}
                      />
                    );
                  }

                  return (
                    <div 
                      key={index} 
                      data-block-index={index}
                      className={`clickable-block reading-block ${cardType} ${isCurrent ? 'highlight' : ''} ${isSearchMatch ? 'has-search-match' : ''}`}
                      onClick={() => playBlock(index)}
                    >
                      {badgeText && (
                        <span className="badge">{badgeText}</span>
                      )}
                      <div dangerouslySetInnerHTML={{ __html: displayHtml }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </main>
        </>
      )}

      {/* Global Player Controller - Always Visible when there is an active session */}
      {activeSession && (
        <footer className="playback-controller">

          {/* Progress Slider */}
          <div className="progress-slider-row">
            <span className="slider-time">{currentBlockIndex + 1}</span>
            <input 
              type="range" 
              className="progress-slider" 
              min="0" 
              max={currentPageBlocks.length > 0 ? currentPageBlocks.length - 1 : 0} 
              value={currentBlockIndex}
              onChange={(e) => playBlock(parseInt(e.target.value))}
            />
            <span className="slider-time">{currentPageBlocks.length}</span>
          </div>

          {/* Controls Row */}
          <div className="playback-controls-row">
            {/* Back Block */}
            <button 
              className="control-icon-btn" 
              disabled={currentBlockIndex === 0 && currentPageIndex === 0} 
              onClick={goToPreviousBlock}
            >
              <Rewind />
            </button>

            {/* Play Pause */}
            <button className="play-main-btn" onClick={togglePlayPause}>
              {isPlaying ? <Pause /> : <Play />}
            </button>

            {/* Forward Block */}
            <button 
              className="control-icon-btn" 
              disabled={currentPageBlocks.length === 0 || (currentBlockIndex === currentPageBlocks.length - 1 && currentPageIndex === (activeSession.totalChunks || 1) - 1)} 
              onClick={advanceNextBlock}
            >
              <FastForward />
            </button>

            {/* Custom Selector Options */}
            <div className="selectors-group">
              {/* Voice Selection Dropdown */}
              {voices.length > 0 && (
                <div className="dropdown-container">
                  <button 
                    className={`controller-pill-btn ${selectedVoice ? 'voice-btn-active' : ''}`}
                    onClick={() => {
                      setIsVoiceDropdownOpen(!isVoiceDropdownOpen);
                      setIsSpeedDropdownOpen(false);
                    }}
                  >
                    <Volume2 className="pill-icon" />
                    <span>{selectedVoice ? (selectedVoice.name.length > 15 ? `${selectedVoice.name.substring(0, 12)}...` : selectedVoice.name) : 'Voz'}</span>
                    <ChevronDown size={14} className="dropdown-arrow" />
                  </button>
                  {isVoiceDropdownOpen && (
                    <div className="custom-dropdown-menu">
                      {voices.map(voice => (
                        <button 
                          key={voice.id} 
                          className={`custom-dropdown-option ${selectedVoice?.id === voice.id ? 'active' : ''}`}
                          onClick={() => changeVoice(voice)}
                        >
                          {voice.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Speed Selection Dropdown */}
              <div className="dropdown-container">
                <button 
                  className="controller-pill-btn"
                  onClick={() => {
                    setIsSpeedDropdownOpen(!isSpeedDropdownOpen);
                    setIsVoiceDropdownOpen(false);
                  }}
                >
                  <Settings className="pill-icon" />
                  <span>{speed}x</span>
                  <ChevronDown size={14} className="dropdown-arrow" />
                </button>
                {isSpeedDropdownOpen && (
                  <div className="custom-dropdown-menu" style={{ minWidth: '100px' }}>
                    {[0.5, 1.0, 1.25, 1.5, 2.0].map(s => (
                      <button 
                        key={s} 
                        className={`custom-dropdown-option ${speed === s ? 'active' : ''}`}
                        onClick={() => changeSpeed(s)}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Theme Selection Dropdown */}
              <div className="dropdown-container">
                <button 
                  className="controller-pill-btn"
                  onClick={() => {
                    setIsThemeDropdownOpen(!isThemeDropdownOpen);
                    setIsVoiceDropdownOpen(false);
                    setIsSpeedDropdownOpen(false);
                  }}
                  title="Tema"
                >
                  <span style={{ marginRight: '4px' }}>{themeIcons[theme]}</span>
                  <span>{themeNames[theme]}</span>
                  <ChevronDown size={14} className="dropdown-arrow" />
                </button>
                {isThemeDropdownOpen && (
                  <div className="custom-dropdown-menu theme-dropdown-menu">
                    {Object.entries(themeNames).map(([key, name]) => (
                      <button
                        key={key}
                        className={`custom-dropdown-option ${theme === key ? 'active' : ''}`}
                        onClick={() => changeTheme(key)}
                      >
                        <span className="theme-option-icon">{themeIcons[key]}</span>
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
