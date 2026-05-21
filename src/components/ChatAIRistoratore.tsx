import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, X, Clock, CheckCircle2, Paperclip, FileText, Image as ImageIcon } from "lucide-react";
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit, deleteDoc, doc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";

export function ChatAIRistoratore({ restaurantId, activeMenu, menus, activePlans, onPlanAdded, onDirectAction, selectedDishIds = [], draftMenu, setDraftMenu }: any) {
  const [chatScope, setChatScope] = useState("all");
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [processedProposals, setProcessedProposals] = useState<Record<string, 'approved' | 'rejected'>>({});

  useEffect(() => {
    if (selectedDishIds.length > 0) {
      setChatScope("targeted");
    }
  }, [selectedDishIds]);
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedFileData, setAttachedFileData] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeMenuId = activeMenu?.id;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith("image/")) {
        try {
          const resizedData = await resizeImage(file);
          setAttachedFile(file);
          setAttachedFileData(resizedData);
        } catch(err) {
          alert("Impossibile leggere l'immagine");
        }
      } else {
        if (file.size > 4 * 1024 * 1024) {
           alert("Il file PDF è troppo grande. Massimo 4MB.");
           return;
        }
        setAttachedFile(file);
        const reader = new FileReader();
        reader.onload = (e) => setAttachedFileData(e.target?.result as string);
        reader.readAsDataURL(file);
      }
    }
  };

  const resizeImage = (file: File): Promise<string> => {
     return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
           const img = new Image();
           img.onload = () => {
              const canvas = document.createElement("canvas");
              let width = img.width, height = img.height;
              const maxDim = 1000;
              if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
              else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
              canvas.width = width; canvas.height = height;
              const ctx = canvas.getContext("2d");
              if (!ctx) return reject(new Error("Canvas non supportato"));
              ctx.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL("image/jpeg", 0.7));
           };
           img.onerror = reject;
           img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
     });
  };

  const clearAttachment = () => {
    setAttachedFile(null);
    setAttachedFileData(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const simplifyMenu = (m: any) => {
    if (!m) return m;
    const { rawExtracted, ...rest } = m;
    return rest;
  };

  useEffect(() => {
    // Load history for specific menu with real-time listener
    if (!restaurantId || !activeMenuId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, `ristoranti/${restaurantId}/chat_history/${activeMenuId}/messaggi`), 
      orderBy("createdAt", "asc"), 
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
        const hist = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (hist.length > 0) {
            setMessages(hist);
        } else {
            setMessages([{ 
                role: "assistant", 
                text: "Ciao! Sono il tuo assistente. Posso modificare i menu, aggiornare i prezzi, o pianificare un cambio menu per il weekend. Cosa vuoi fare?",
                createdAt: new Date().toISOString()
            }]);
        }
    });

    return () => unsubscribe();
  }, [restaurantId, activeMenuId]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, isTyping]);

  function computeAllergeni(
    ingredienti: any,
    context?: { nome?: string; categoria?: string; menuType?: string; descrizione?: string }
  ): string[] {
    const allergensSet = new Set<string>();
    
    let extractedIngs: string[] = [];
    if (Array.isArray(ingredienti)) {
      extractedIngs = ingredienti;
    } else if (ingredienti && typeof ingredienti === 'object') {
      if (Array.isArray(ingredienti.it)) {
        extractedIngs = ingredienti.it;
      } else {
        const firstArray = Object.values(ingredienti).find(v => Array.isArray(v));
        if (Array.isArray(firstArray)) {
          extractedIngs = firstArray as string[];
        }
      }
    }
    
    const rawIngs: any[] = [...extractedIngs];
    if (context?.nome) {
      if (typeof context.nome === "string") rawIngs.push(context.nome);
      else if (typeof context.nome === "object" && (context.nome as any).it) rawIngs.push((context.nome as any).it);
    }
    if (context?.descrizione) {
      if (typeof context.descrizione === "string") rawIngs.push(context.descrizione);
      else if (typeof context.descrizione === "object" && (context.descrizione as any).it) rawIngs.push((context.descrizione as any).it);
    }
    
    const ingsLower = rawIngs
      .map(i => {
        if (typeof i === "string") return i.toLowerCase();
        if (i && typeof i === "object") {
          if (typeof i.it === "string") return i.it.toLowerCase();
          const firstString = Object.values(i).find(v => typeof v === "string");
          if (typeof firstString === "string") return firstString.toLowerCase();
        }
        return "";
      })
      .filter(s => s.length > 0);
  
    const mappature: Record<string, string[]> = {
      "glutine": ["spaghetti", "linguine", "troccoli", "tagliolino", "orecchiette", "ravioli", "lasagne", "gnocchi", "penne", "fettuccine", "pasta", "pane", "pizza", "mollica", "farina", "pangrattato", "crosta", "würstel", "mortadella", "ventricina", "calzone", "base pizza", "base bianca", "frittura"],
      "crostacei": ["scampi", "gamberi", "gambero", "granchio", "aragosta", "astice", "mazzancolle", "mare"],
      "uova": ["uovo", "uova", "pasta all'uovo", "tagliolino", "maionese", "tiramisù", "frittata", "frittura"],
      "pesce": ["tonno", "acciuga", "acciughe", "alici", "salmone", "branzino", "orata", "ricciola", "sgombro", "spigola", "colatura di alici", "pescato", "mare"],
      "arachidi": ["arachidi", "arachide", "burro di arachidi"],
      "soia": ["soia", "salsa di soia", "edamame", "tofu"],
      "latte": ["latte", "mozzarella", "fior di latte", "burrata", "burratina", "ricotta", "scamorza", "provola", "pecorino", "parmigiano", "grana", "gorgonzola", "feta", "emmental", "burro", "panna", "mascarpone", "yogurt", "gelato", "spumone", "tiramisù", "formaggio", "cacio"],
      "frutta_a_guscio": ["pistacchi", "pistacchio", "granella di pistacchio", "mandorle", "mandorla", "noci", "nocciole", "anacardi", "pinoli"],
      "sedano": ["sedano"],
      "senape": ["senape", "mostarda"],
      "sesamo": ["sesamo", "semi di sesamo", "crosta di sesamo"],
      "solfiti": ["vino", "aceto", "ventricina", "würstel", "mortadella", "speck", "salame"],
      "lupini": ["lupino", "lupini"],
      "molluschi": ["cozze", "vongole", "polipo", "polpo", "calamari", "calamaro", "seppia", "ostriche", "lumache di mare", "mare"]
    };
  
    for (const ing of ingsLower) {
      for (const [allergen, keywords] of Object.entries(mappature)) {
        for (const keyword of keywords) {
          if (ing.includes(keyword)) {
            if (allergen === "lupini" && (ing.includes("vongola lupino") || ing.includes("vongole lupino"))) {
              continue;
            }
            allergensSet.add(allergen);
            break;
          }
        }
      }
    }
  
    const ctxString = `${context?.nome || ""} ${context?.categoria || ""} ${context?.menuType || ""}`.toLowerCase();
    
    if (ctxString.includes("pizza") || ctxString.includes("calzone")) {
      allergensSet.add("glutine");
    }
    
    const nomeLower = (typeof context?.nome === "string" ? context.nome : (context?.nome as any)?.it || "").toLowerCase();
    const isFruitDessert = nomeLower.includes("frutta") || nomeLower.includes("sorbetto") || nomeLower.includes("ananas") || nomeLower.includes("melone");
    
    if (!isFruitDessert) {
      if (ctxString.includes("dolc") || ctxString.includes("dessert") || ctxString.includes("tiramisù") || ctxString.includes("spumone")) {
        allergensSet.add("glutine");
        allergensSet.add("uova");
        allergensSet.add("latte");
      }
    }
  
    return Array.from(allergensSet);
  }

  const handleApproveProposal = (proposal: any) => {
    if (!setDraftMenu) return;
    setDraftMenu((prevDraft: any) => {
      if (!prevDraft) {
        alert("Nessun menu in bozza (staging area) attivo da modificare. Carica un file per iniziare.");
        return prevDraft;
      }
      
      const updatedDishesByCategoryId = (prevDraft.dishesByCategoryId || []).map((group: any) => {
        const updatedDishes = group.dishes.map((dish: any) => {
          const isMatch = dish.id === proposal.dishId || 
                          (dish.id && proposal.dishId && String(dish.id) === String(proposal.dishId)) ||
                          (typeof dish.nome === "object" ? dish.nome?.it : dish.nome) === proposal.nome ||
                          (typeof dish.name === "object" ? dish.name?.it : dish.name) === proposal.nome;

          if (isMatch) {
            const field = proposal.field;
            const newValue = proposal.newValue;
            let updatedDish = { ...dish };

            if (field === "prezzo" || field === "price") {
              updatedDish.prezzo = Number(newValue);
              updatedDish.price = Number(newValue);
            } else if (field === "ingredienti" || field === "ingredients") {
              const arr = Array.isArray(newValue) ? newValue : [newValue];
              if (typeof dish.ingredienti === "object" && dish.ingredienti !== null && !Array.isArray(dish.ingredienti)) {
                updatedDish.ingredienti = { ...dish.ingredienti, it: arr };
              } else {
                updatedDish.ingredienti = arr;
              }
              if (typeof dish.ingredients === "object" && dish.ingredients !== null && !Array.isArray(dish.ingredients)) {
                updatedDish.ingredients = { ...dish.ingredients, it: arr };
              } else {
                updatedDish.ingredients = arr;
              }
            } else if (field === "nome" || field === "name") {
              if (typeof dish.nome === "object" && dish.nome !== null) {
                updatedDish.nome = { ...dish.nome, it: String(newValue) };
              } else {
                updatedDish.nome = String(newValue);
              }
              if (typeof dish.name === "object" && dish.name !== null) {
                updatedDish.name = { ...dish.name, it: String(newValue) };
              } else {
                updatedDish.name = String(newValue);
              }
            } else if (field === "descrizione" || field === "description") {
              if (typeof dish.descrizione === "object" && dish.descrizione !== null) {
                updatedDish.descrizione = { ...dish.descrizione, it: String(newValue) };
              } else {
                updatedDish.descrizione = String(newValue);
              }
              if (typeof dish.description === "object" && dish.description !== null) {
                updatedDish.description = { ...dish.description, it: String(newValue) };
              } else {
                updatedDish.description = String(newValue);
              }
            } else {
              updatedDish[field] = newValue;
            }

            // Recalculate allergens immediately!
            const newAllergens = computeAllergeni(
              updatedDish.ingredienti || updatedDish.ingredients,
              {
                nome: updatedDish.nome || updatedDish.name,
                descrizione: updatedDish.descrizione || updatedDish.description,
                categoria: group.categoryId,
                menuType: prevDraft.tipo
              }
            );
            
            updatedDish.allergeni = newAllergens;
            updatedDish.allergens = newAllergens;
            return updatedDish;
          }
          return dish;
        });

        return {
          ...group,
          dishes: updatedDishes
        };
      });

      return {
        ...prevDraft,
        dishesByCategoryId: updatedDishesByCategoryId
      };
    });
  };

  const parseAIMessage = (rawText: string | undefined) => {
    if (!rawText) return { text: "", azione_proposta: null, proposalUi: null };
    
    // Estrai blocco ```json ... ```
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    let azione_proposta = null;
    let proposalUi = null;
    let cleanText = rawText;
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.type === "PROPOSAL_UI") {
          proposalUi = parsed;
          cleanText = parsed.message || "";
        } else {
          azione_proposta = parsed.azione_proposta || parsed;
          cleanText = rawText.replace(jsonMatch[0], '').trim();
        }
      } catch (e) {
        console.error('Failed to parse action JSON', e);
      }
    }
    
    // Fallback search for bare JSON
    if (!azione_proposta && !proposalUi) {
      const rawJsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (rawJsonMatch) {
         try {
           const parsed = JSON.parse(rawJsonMatch[0]);
           if (parsed.type === "PROPOSAL_UI") {
             proposalUi = parsed;
             cleanText = parsed.message || "";
           } else if (parsed.azione_proposta) {
             azione_proposta = parsed.azione_proposta;
             cleanText = rawText.replace(rawJsonMatch[0], '').trim();
           } else {
             // bare json action
             azione_proposta = parsed;
             cleanText = rawText.replace(rawJsonMatch[0], '').trim();
           }
         } catch (e) {}
      }
    }
    
    return { text: cleanText, azione_proposta, proposalUi };
  };

  const saveMessage = async (msg: any) => {
    if (!restaurantId || !activeMenuId) return null;
    try {
      const docRef = await addDoc(collection(db, `ristoranti/${restaurantId}/chat_history/${activeMenuId}/messaggi`), {
        ...msg,
        createdAt: serverTimestamp()
      });
      return docRef.id;
    } catch (e) {
      console.error("Save Error", e);
      return null;
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && !attachedFileData) || isTyping || !activeMenuId) return;
    
    const userMsg = input.trim();
    const newUserMsg = { 
        role: "user", 
        text: userMsg || (attachedFileData ? "Ho caricato un file in allegato." : ""), 
        hasAttachment: !!attachedFileData,
        attachmentName: attachedFile?.name || null,
        createdAt: new Date().toISOString() 
    };
    
    const currentFileData = attachedFileData;
    const currentFileType = attachedFile?.type;

    // Add provisionally
    setMessages(prev => [...prev, newUserMsg]);
    setInput("");
    clearAttachment();
    setIsTyping(true);
    
    const userDocId = await saveMessage(newUserMsg);
    if (userDocId) {
      setMessages(prev => prev.map(m => m === newUserMsg ? { ...m, id: userDocId } : m));
    }

    // Determine target scope string
    const mappedScope = chatScope === "all" ? "TUTTO_IL_MENU" : chatScope === "sections" ? "FILTRA_SEZIONI" : "SELEZIONE_MIRATA";

    try {
      const response = await fetch("/api/owner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userMsg, 
          scope: mappedScope,
          selectedDishIds,
          restaurantId,
          menus: (menus || []).map(simplifyMenu),
          activeMenuContext: simplifyMenu(activeMenu),
          activePlans,
          history: messages.slice(-20),
          fileData: currentFileData,
          mimeType: currentFileType
        })
      });
      if (!response.ok) {
         const txt = await response.text();
         throw new Error(txt || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(typeof data.error === 'object' ? data.error.message || JSON.stringify(data.error) : data.error);
      }
      
      const { text, azione_proposta, proposalUi } = parseAIMessage(data.text);

      const newAiMsg = { 
        role: "assistant", 
        text: text || "Ok", 
        azione_proposta, 
        proposalUi,
        createdAt: new Date().toISOString() 
      };
      
      setMessages(prev => [...prev, newAiMsg]);
      const aiDocId = await saveMessage(newAiMsg);
      if (aiDocId) {
        setMessages(prev => prev.map(m => m === newAiMsg ? { ...m, id: aiDocId } : m));
      }

    } catch (error: any) {
      console.error(error);
      alert("Errore di connessione: " + error.message);
    } finally {
      setIsTyping(false);
    }
  };

  const handleConfirmAction = async (msgIndex: number, action: any, isConfirm: boolean) => {
     const msg = messages[msgIndex];
     if (!msg.id || !restaurantId || !activeMenuId) return;

     const updateLocal = (field: string) => {
        setMessages(prev => {
            const newMsgs = [...prev];
            newMsgs[msgIndex] = { ...newMsgs[msgIndex], [field]: true };
            return newMsgs;
        });
     };

     if (!isConfirm) {
         updateLocal("azione_annullata");
         await updateDoc(doc(db, `ristoranti/${restaurantId}/chat_history/${activeMenuId}/messaggi`, msg.id), { azione_annullata: true });
         
         // Notify API of cancellation
         setIsTyping(true);
         try {
             const response = await fetch("/api/owner/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    trigger: "action_cancelled",
                    action_desc: action.descrizione,
                    restaurantId,
                    menus: (menus || []).map(simplifyMenu),
                    activeMenuContext: simplifyMenu(activeMenu),
                    activePlans,
                    history: messages.slice(-20)
                })
             });
             if (!response.ok) throw new Error("Errore comunicazione server");
             const data = await response.json();
             const aiMsg = { 
                 role: "assistant", 
                 text: data.text || "Operazione annullata.", 
                 createdAt: new Date().toISOString() 
             };
             await saveMessage(aiMsg);
         } catch (e) {
             console.error("Cancel notify error", e);
         } finally {
             setIsTyping(false);
         }
         return;
     }

     try {
       if (action.type.includes("schedule")) {
           await addDoc(collection(db, `ristoranti/${restaurantId}/pianificazioni`), {
               tipo: action.type,
               target: action.target,
               azione: action.updates,
               trigger_datetime: action.trigger_datetime || new Date().toISOString(),
               stato: "schedulato",
               descritto_come: action.descrizione || "",
               createdAt: new Date().toISOString()
           });
           onPlanAdded();
       } else {
           if (onDirectAction) {
               await onDirectAction(action);
           }
       }

       updateLocal("azione_eseguita");
       await updateDoc(doc(db, `ristoranti/${restaurantId}/chat_history/${activeMenuId}/messaggi`, msg.id), { azione_eseguita: true });

     } catch (err: any) {
        console.error("Action Error", err);
        alert("Errore nell'esecuzione: " + err.message);
     }
  };

  return (
    <div className="flex flex-col h-[500px] border border-sand bg-white rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-sea flex justify-between items-center text-white border-b border-sea-light/20">
        <div className="flex items-center gap-2">
           <Sparkles size={16} />
           <span className="font-serif text-sm">Assistente AI</span>
        </div>
        <div className="text-[10px] text-sea-light uppercase">
           {activeMenu ? `Menu: ${activeMenu.name}` : 'Nessun menu'}
        </div>
      </div>

      {/* Scope Selector Bar / Ponte con la Chat */}
      <div className="flex gap-1.5 p-2 bg-sand/30 border-b border-sand">
        <button
          onClick={() => setChatScope("all")}
          className={clsx(
            "flex-1 py-1.5 text-[9px] uppercase font-extrabold rounded-lg border text-center transition-all",
            chatScope === "all"
              ? "bg-sea text-white border-sea shadow"
              : "bg-white border-sand text-olive hover:bg-sand/30"
          )}
        >
          Tutto il Menu
        </button>
        <button
          onClick={() => setChatScope("sections")}
          className={clsx(
            "flex-1 py-1.5 text-[9px] uppercase font-extrabold rounded-lg border text-center transition-all",
            chatScope === "sections"
              ? "bg-sea text-white border-sea shadow"
              : "bg-white border-sand text-olive hover:bg-sand/30"
          )}
        >
          Filtra Sezioni
        </button>
        <button
          onClick={() => setChatScope("targeted")}
          className={clsx(
            "flex-1 py-1.5 text-[9px] uppercase font-extrabold rounded-lg border text-center transition-all flex items-center justify-center gap-1",
            chatScope === "targeted"
              ? "bg-sea text-white border-sea shadow"
              : "bg-white border-sand text-olive hover:bg-sand/30"
          )}
        >
          <span>Selezione Mirata</span>
          {selectedDishIds.length > 0 && (
            <span className="px-1.5 py-0.2 bg-red-500 text-white rounded-full text-[8px] font-black shadow-sm animate-pulse">
              {selectedDishIds.length}
            </span>
          )}
        </button>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-sand/10">
        {messages.map((m, i) => (
          <div key={i} className={clsx("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div className={clsx("max-w-[85%] p-3 rounded-2xl text-sm w-full", m.role === "user" ? "bg-sea text-white rounded-br-none max-w-[85%] ml-auto" : "bg-white border border-sand rounded-bl-none text-olive")}>
                {m.hasAttachment && (
                  <div className="flex items-center gap-2 mb-2 p-2 bg-black/10 rounded-lg text-xs">
                     <FileText size={14} />
                     <span className="truncate">{m.attachmentName || "Allegato"}</span>
                  </div>
                )}
                <div className="prose prose-sm font-sans">{m.text}</div>

                {/* VISUAL PROPOSALS CARDS */}
                {m.proposalUi && m.proposalUi.proposals && m.proposalUi.proposals.length > 0 && (
                  <div className="mt-3 space-y-3 font-sans">
                    {m.proposalUi.proposals.map((proposal: any, pIdx: number) => {
                      const statusKey = `${i}_${pIdx}`;
                      const status = processedProposals[statusKey];

                      let changeDetails = "";
                      if (proposal.field === "prezzo" || proposal.field === "price") {
                        changeDetails = `Prezzo: €${proposal.oldValue} ➔ €${proposal.newValue}`;
                      } else if (proposal.field === "ingredienti" || proposal.field === "ingredients") {
                        const oldIngs = Array.isArray(proposal.oldValue) ? proposal.oldValue.join(", ") : String(proposal.oldValue || "Nessuno");
                        const newIngs = Array.isArray(proposal.newValue) ? proposal.newValue.join(", ") : String(proposal.newValue || "Nessuno");
                        changeDetails = `Ingredienti: [${oldIngs}] ➔ [${newIngs}]`;
                      } else {
                        changeDetails = `${proposal.field}: "${proposal.oldValue || 'Vuoto'}" ➔ "${proposal.newValue || 'Vuoto'}"`;
                      }

                      return (
                        <div key={pIdx} className="bg-sand/30 border border-sand p-3 rounded-xl space-y-2 text-olive shadow-xs">
                          <p className="text-xs font-serif font-bold text-sea">{proposal.nome || "Piatto senza nome"}</p>
                          <p className="text-xs text-olive bg-white p-2.5 rounded-lg border border-sand-dark/10 font-mono break-all leading-relaxed">
                            {changeDetails}
                          </p>
                          
                          {!status ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  handleApproveProposal(proposal);
                                  setProcessedProposals(prev => ({ ...prev, [statusKey]: 'approved' }));
                                }}
                                className="flex-1 py-1.5 px-3 bg-green-600 hover:bg-green-700 active:scale-95 transition-all text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                              >
                                ✓ Approva
                              </button>
                              <button
                                onClick={() => {
                                  setProcessedProposals(prev => ({ ...prev, [statusKey]: 'rejected' }));
                                }}
                                className="py-1.5 px-3 border border-sand hover:bg-red-50 active:scale-95 transition-all text-red-600 font-medium text-xs rounded-lg cursor-pointer"
                              >
                                ✕ Rifiuta
                              </button>
                            </div>
                          ) : status === 'approved' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 bg-green-50 px-2 py-1 rounded-md border border-green-200">
                              ✓ Modifica Approvata
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-md border border-red-200">
                              ✕ Modifica Rifiutata
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
            {m.azione_proposta && m.role === "assistant" && (
                <div className="mt-2 p-3 bg-white border border-sand rounded-xl text-sm flex flex-col gap-3 max-w-[95%] shadow-sm w-full">
                   <div className="flex items-center gap-2 text-olive font-semibold border-b border-sand pb-2">
                       {m.azione_proposta.type?.includes("schedule") ? <Clock size={16} className="text-sea" /> : <Sparkles size={16} className="text-sea" />}
                       Azione Proposta
                   </div>
                   <p className="text-olive">{m.azione_proposta.descrizione || "Vuoi applicare questa modifica?"}</p>
                   
                   {!m.azione_eseguita && !m.azione_annullata ? (
                     <div className="flex gap-2 mt-1">
                        <button onClick={() => handleConfirmAction(i, m.azione_proposta, true)} className="flex-1 px-3 py-2 bg-sea text-white rounded-lg active:scale-95 transition-transform flex justify-center items-center gap-2 font-medium">
                           Conferma
                        </button>
                        <button onClick={() => handleConfirmAction(i, m.azione_proposta, false)} className="px-4 py-2 border border-sand text-olive rounded-lg hover:bg-sand/30 active:scale-95 transition-transform font-medium">
                           Annulla
                        </button>
                     </div>
                   ) : m.azione_eseguita ? (
                     <div className="flex items-center gap-1.5 text-green-600 font-medium text-sm mt-1">
                        <CheckCircle2 size={16} /> ✓ Fatto
                     </div>
                   ) : (
                     <div className="flex items-center gap-1.5 text-olive/60 font-medium text-sm mt-1">
                        <X size={16} /> Annullato
                     </div>
                   )}
                </div>
            )}
          </div>
        ))}
        {isTyping && (
           <div className="bg-white border border-sand p-3 rounded-2xl rounded-bl-none w-fit">
              <span className="animate-pulse">...</span>
           </div>
        )}
      </div>

      <div className="p-3 bg-white border-t border-sand flex flex-col gap-2">
        {attachedFile && (
          <div className="flex justify-between items-center bg-sand/30 p-2 rounded-xl border border-sand-dark/10">
            <div className="flex items-center gap-2 text-olive text-sm truncate">
              {attachedFile.type.startsWith("image/") ? <ImageIcon size={16} /> : <FileText size={16} />}
              <span className="truncate max-w-[200px]">{attachedFile.name}</span>
            </div>
            <button onClick={clearAttachment} className="text-olive/50 hover:text-olive">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex gap-2 items-center">
           <input 
             type="file" 
             ref={fileInputRef} 
             onChange={handleFileChange} 
             className="hidden" 
             accept="image/*,application/pdf"
           />
           <button 
             onClick={() => fileInputRef.current?.click()} 
             className="p-2 text-olive/60 hover:text-sea hover:bg-sand/30 rounded-xl transition-colors"
           >
             <Paperclip size={20} />
           </button>
           <input 
             value={input} 
             onChange={e => setInput(e.target.value)}
             onKeyDown={e => e.key === "Enter" && sendMessage()}
             className="flex-1 px-3 py-2 border border-sand rounded-xl bg-sand/20 outline-none focus:border-sea text-sm text-olive placeholder:text-olive/40"
             placeholder="Chiedi modifiche al menu..."
           />
           <button onClick={sendMessage} className="p-2 bg-sea text-white rounded-xl active:scale-95 transition-transform hover:bg-sea-light" disabled={isTyping || (!input.trim() && !attachedFileData)}>
             <Send size={16} />
           </button>
        </div>
      </div>
    </div>
  );
}
