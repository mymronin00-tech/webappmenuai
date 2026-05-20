import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, X, Clock, CheckCircle2, Paperclip, FileText, Image as ImageIcon } from "lucide-react";
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit, deleteDoc, doc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import clsx from "clsx";
import { motion, AnimatePresence } from "framer-motion";

export function ChatAIRistoratore({ restaurantId, activeMenu, menus, activePlans, onPlanAdded, onDirectAction }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
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

  const parseAIMessage = (rawText: string | undefined) => {
    if (!rawText) return { text: "", azione_proposta: null };
    
    // Estrai blocco ```json ... ```
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    let azione_proposta = null;
    let cleanText = rawText;
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        azione_proposta = parsed.azione_proposta || parsed;
        cleanText = rawText.replace(jsonMatch[0], '').trim();
      } catch (e) {
        console.error('Failed to parse action JSON', e);
      }
    }
    
    // Fallback search for bare JSON { "azione_proposta": ... }
    if (!azione_proposta) {
      const rawJsonMatch = rawText.match(/\{[\s\S]*"azione_proposta"[\s\S]*\}/);
      if (rawJsonMatch) {
        try {
          const parsed = JSON.parse(rawJsonMatch[0]);
          azione_proposta = parsed.azione_proposta;
          cleanText = rawText.replace(rawJsonMatch[0], '').trim();
        } catch (e) {}
      }
    }
    
    return { text: cleanText, azione_proposta };
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

    try {
      const response = await fetch("/api/owner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userMsg, 
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
      
      const { text, azione_proposta } = parseAIMessage(data.text);

      const newAiMsg = { 
        role: "assistant", 
        text: text || "Ok", 
        azione_proposta, 
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
      <div className="px-4 py-3 bg-sea flex justify-between items-center text-white">
        <div className="flex items-center gap-2">
           <Sparkles size={16} />
           <span className="font-serif text-sm">Assistente AI</span>
        </div>
        <div className="text-[10px] text-sea-light uppercase">
           {activeMenu ? `Menu: ${activeMenu.name}` : 'Nessun menu'}
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-sand/10">
        {messages.map((m, i) => (
          <div key={i} className={clsx("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div className={clsx("max-w-[85%] p-3 rounded-2xl text-sm", m.role === "user" ? "bg-sea text-white rounded-br-none" : "bg-white border border-sand rounded-bl-none text-olive")}>
                {m.hasAttachment && (
                  <div className="flex items-center gap-2 mb-2 p-2 bg-black/10 rounded-lg text-xs">
                     <FileText size={14} />
                     <span className="truncate">{m.attachmentName || "Allegato"}</span>
                  </div>
                )}
                {m.text}
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
