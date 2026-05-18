import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { db } from "../lib/firebase";
import { doc, getDoc, collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { Globe, MessageSquare, Info, Filter, Sparkles, ChefHat, X, Send, ChevronDown, User, Loader2, Bell, Leaf, Wine, Grape, GlassWater, Droplets, Martini } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

export function getLocalized(
  field: any, 
  currentLang: string, 
  defaultLang: string = "it"
): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (typeof field !== "object") return "";
  
  // Cerca prima nella lingua corrente
  if (field[currentLang] && field[currentLang].trim() !== "") {
    return field[currentLang];
  }
  
  // Fallback alla lingua di default
  if (field[defaultLang] && field[defaultLang].trim() !== "") {
    return field[defaultLang];
  }
  
  // Fallback a qualunque valore presente
  for (const key of Object.keys(field)) {
    if (field[key] && typeof field[key] === "string" && field[key].trim() !== "") {
      return field[key];
    }
  }
  
  return "";
}

type Language = "it" | "en" | "fr" | "de";

export default function CustomerMenu() {
  const { restaurantId } = useParams();
  const [restaurant, setRestaurant] = useState<any>(null);
  const [menus, setMenus] = useState<any[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>(() => {
    const urlParam = new URLSearchParams(window.location.search).get("lang");
    if (urlParam && ["it","en","fr","de"].includes(urlParam)) return urlParam as Language;
    
    const stored = localStorage.getItem("menulive_lang");
    if (stored && ["it","en","fr","de"].includes(stored)) return stored as Language;
    
    const browser = navigator.language?.split("-")[0];
    if (browser && ["it","en","fr","de"].includes(browser)) return browser as Language;
    
    return "it";
  });
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("menulive_lang", lang);
  }, [lang]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, [restaurantId]);

  const fetchData = async () => {
    if (!restaurantId) return;
    try {
      const resDoc = await getDoc(doc(db, "ristoranti", restaurantId));
      if (!resDoc.exists()) return;
      setRestaurant(resDoc.data());

      const menuQuery = query(collection(db, `ristoranti/${restaurantId}/menus`), where("isPublished", "==", true));
      const menuSnapshot = await getDocs(menuQuery);
      if (menuSnapshot.empty) { setLoading(false); return; }
      
      const menusList = menuSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setMenus(menusList);
      const initialMenuId = menusList[0].id;
      setActiveMenuId(initialMenuId);
      await fetchCategories(initialMenuId);
      setLoading(false);
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  const fetchCategories = async (menuId: string) => {
    const catQuery = collection(db, `ristoranti/${restaurantId}/menus/${menuId}/categorie`);
    const catSnapshot = await getDocs(catQuery);
    
    const catsData = catSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any })).sort((a, b) => (a.order || 0) - (b.order || 0));

    const cats = await Promise.all(catsData.map(async (cData: any) => {
      const dishSnapshot = await getDocs(collection(db, `ristoranti/${restaurantId}/menus/${menuId}/categorie/${cData.id}/piatti`));
      return { ...cData, dishes: dishSnapshot.docs.map(d => ({ id: d.id, ...d.data() })) };
    }));

    setCategories(cats);
    if (cats.length > 0) setActiveCategory(cats[0].id);
  };

  const handleMenuChange = async (menuId: string) => {
    setActiveMenuId(menuId);
    await fetchCategories(menuId);
  };

  const activeMenuObj = menus.find(m => m.id === activeMenuId);

  if (loading) return <div className="h-screen flex items-center justify-center bg-sand"><Loader2 className="animate-spin text-sea" size={32} /></div>;

  return (
    <div className="max-w-md mx-auto min-h-screen bg-sand flex flex-col font-sans border-x border-sand-dark/10 shadow-2xl relative overflow-hidden">
      <header className="px-6 py-6 bg-sand sticky top-0 z-20 border-b border-sand/50">
        <div className="flex justify-between items-start mb-6">
          <div className="flex-1">
            <h1 className="text-3xl font-serif text-sea leading-tight">{restaurant?.name}</h1>
            <p className="text-xs text-olive uppercase tracking-[0.2em] font-medium mt-1">Menu Live</p>
          </div>
          <div className="flex items-center bg-white border border-sand-dark/20 rounded-full px-3 py-1.5 shadow-sm">
            <Globe size={14} className="mr-2 opacity-60" />
            <select value={lang} onChange={(e) => setLang(e.target.value as Language)} className="text-xs font-semibold bg-transparent outline-none uppercase">
              <option value="it">IT</option><option value="en">EN</option><option value="fr">FR</option><option value="de">DE</option>
            </select>
          </div>
        </div>

        {menus.length > 1 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-none">
            {menus.map((m) => (
              <button key={m.id} onClick={() => handleMenuChange(m.id)} className={clsx("px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all", activeMenuId === m.id ? "bg-sea text-white shadow-md shadow-sea/20" : "bg-sand-dark/10 text-olive hover:bg-sand-dark/20")}>
                {m.name || "Menu"}
              </button>
            ))}
          </div>
        )}

        {/* Diet Filters (only for food) */}
        {["ristorante", "pizzeria", "bar"].includes(activeMenuObj?.tipo || "ristorante") && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-none">
             <button className="px-3 py-1 bg-white border border-sand rounded-xl text-[10px] uppercase font-bold text-olive flex items-center gap-1 shrink-0"><Leaf size={12} className="text-green-600"/> Vegetariano</button>
             <button className="px-3 py-1 bg-white border border-sand rounded-xl text-[10px] uppercase font-bold text-olive flex items-center gap-1 shrink-0">Vegano</button>
             <button className="px-3 py-1 bg-white border border-sand rounded-xl text-[10px] uppercase font-bold text-olive flex items-center gap-1 shrink-0">Senza Glutine</button>
             <button className="px-3 py-1 bg-white border border-sand rounded-xl text-[10px] uppercase font-bold text-olive flex items-center gap-1 shrink-0">Senza Lattosio</button>
          </div>
        )}

        <div className="flex gap-4 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-none">
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={clsx("text-sm font-medium whitespace-nowrap pb-1.5 transition-all relative", activeCategory === cat.id ? "text-sea" : "text-olive/60")}>
              {getLocalized(cat.name, lang)}
              {activeCategory === cat.id && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-sea" />}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 px-6 py-6 pb-32 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={activeCategory} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className={clsx("space-y-4", (activeMenuObj?.tipo === "bar") ? "space-y-1" : "space-y-6")}>
            {(categories.find(c => c.id === activeCategory)?.dishes || []).map((item: any) => (
              <PolymorphicItem key={item.id} item={item} lang={lang} menuType={activeMenuObj?.tipo || "ristorante"} onClick={() => setSelectedItem(item)} />
            ))}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 z-30 pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={() => setIsChatOpen(true)} className="flex-1 bg-sea text-white h-14 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-sea/20 font-medium active:scale-95 transition-all">
            <Sparkles size={20} /> Aiutami a scegliere
          </button>
        </div>
      </footer>

      <ItemDetailSheet isOpen={!!selectedItem} onClose={() => setSelectedItem(null)} item={selectedItem} lang={lang} />

      <AIChatSheet isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} menuContext={menus} lang={lang} />
    </div>
  );
}

function PolymorphicItem({ item, lang, menuType, onClick }: any) {
  const isSemplice = menuType === "bar" || item.tipo === "bar_semplice";
  const name = getLocalized(item.nome || item.name, lang);
  const desc = getLocalized(item.descrizione || item.description, lang);
  const price = item.prezzo || item.price;

  if (isSemplice) {
     return (
       <div className="flex justify-between items-center py-3 border-b border-sand/50">
          <div>
            <h3 className="font-serif text-sea font-medium">{name}</h3>
            {desc && <p className="text-[10px] text-olive">{desc}</p>}
          </div>
          <span className="font-semibold text-sm">€{price}</span>
       </div>
     );
  }

  // Cocktail
  if (menuType === "cocktail" || item.tipo === "cocktail") {
     return (
       <div onClick={onClick} className="bg-white p-4 rounded-2xl border border-sand cursor-pointer hover:border-sea/30 transition-colors shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-sand/50 to-transparent -mr-5 -mt-5 rounded-bl-[40px] z-0"></div>
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-2">
               <div>
                  <h3 className="text-xl font-serif text-sea leading-snug">{name}</h3>
                  <p className="text-[10px] uppercase font-bold text-olive/50 tracking-wider">
                     {item.categoria_drink || "Cocktail"} • {item.base_alcolica}
                  </p>
               </div>
               <span className="text-sea font-semibold">€{price}</span>
            </div>
            {item.ingredienti && <p className="text-xs text-olive/80 line-clamp-2 italic">{Array.isArray(item.ingredienti) ? item.ingredienti.join(", ") : item.ingredienti}</p>}
            <div className="mt-3 flex items-center text-[10px] font-bold text-sea uppercase">
               <Martini size={12} className="mr-1" /> Tap per info Bartender
            </div>
          </div>
       </div>
     );
  }

  // Wine
  if (menuType === "carta_vini" || item.tipo === "vino") {
     return (
       <div onClick={onClick} className="flex border-b border-sand/50 py-4 cursor-pointer hover:bg-white/50 px-2 -mx-2 rounded-xl transition-colors">
          <div className="w-10 flex flex-col items-center pt-1 text-olive/30 shrink-0">
             <Wine size={20} />
          </div>
          <div className="flex-1">
             <h3 className="font-serif text-sea text-lg leading-tight">{name}</h3>
             <p className="text-xs font-bold text-olive uppercase tracking-wider mb-1">{item.cantina} {item.annata ? `• ${item.annata}` : ""}</p>
             <p className="text-[11px] text-olive/70 italic line-clamp-1">{item.zona} • {Array.isArray(item.vitigni) ? item.vitigni.join(', ') : item.vitigni}</p>
             <div className="mt-2 text-[10px] text-sea flex items-center gap-1">
                <Sparkles size={10} /> Tap per Info Sommelier
             </div>
          </div>
          <div className="text-right shrink-0 font-semibold self-start mt-1">€{price}</div>
       </div>
     );
  }

  // Dish default
  return (
    <div onClick={item.foto_url || item.imageUrl ? undefined : onClick} className={clsx("group", (item.foto_url || item.imageUrl || desc) ? "cursor-pointer" : "")}>
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <h3 className="text-lg font-serif text-sea leading-snug">{name}</h3>
            <div className="flex-1 border-b border-dotted border-olive/30 mx-1"></div>
            <span className="text-sm font-semibold">€{price}</span>
          </div>
          <p className="text-sm text-olive/80 leading-relaxed italic pr-4 line-clamp-2">{desc}</p>
          <div className="flex gap-2 mt-3 items-center">
            {item.allergens?.map((a: string) => <span key={a} title={a} className="w-5 h-5 flex items-center justify-center bg-sand-dark/10 rounded-full text-[10px] opacity-70">{a.charAt(0).toUpperCase()}</span>)}
            {item.tag_dietetici?.map((t: string) => <span key={t} className="text-[10px] text-olive uppercase tracking-wider font-semibold opacity-50">• {t}</span>)}
          </div>
        </div>
        {(item.foto_url || item.imageUrl) && (
          <div className="w-20 h-20 bg-sand-dark/20 rounded-xl overflow-hidden shrink-0 shadow-inner">
             <img src={item.foto_url || item.imageUrl} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
          </div>
        )}
      </div>
    </div>
  );
}

function ItemDetailSheet({ isOpen, onClose, item, lang }: any) {
  if (!item) return null;
  const name = getLocalized(item.nome || item.name, lang);
  const desc = getLocalized(item.descrizione || item.description, lang);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-sea/20 backdrop-blur-sm z-40" />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed bottom-0 left-0 right-0 max-w-md mx-auto min-h-[50vh] max-h-[85vh] bg-white rounded-t-[40px] z-50 flex flex-col border-t border-sand shadow-2xl overflow-y-auto">
            <div className="w-12 h-1 bg-olive/20 rounded-full mx-auto my-4 shrink-0" />
            <div className="px-8 pb-8 pt-2 relative">
               <button onClick={onClose} className="absolute top-0 right-6 w-8 h-8 bg-sand rounded-full flex items-center justify-center text-olive"><X size={16}/></button>
               
               {item.tipo === "vino" || item.cantina ? (
                  <div className="mt-4 space-y-6">
                     <div className="text-center">
                        <Wine size={32} className="mx-auto text-red-900/30 mb-2" />
                        <h2 className="text-3xl font-serif text-sea leading-tight">{name}</h2>
                        <p className="text-sm font-bold uppercase tracking-widest text-olive mt-2">{item.cantina} • {item.annata}</p>
                     </div>
                     <div className="bg-sand p-6 rounded-2xl text-sm text-olive space-y-3 relative overflow-hidden">
                        <Grape className="absolute -bottom-4 -right-4 text-white opacity-40" size={100} />
                        <p><strong>Zona:</strong> {item.zona}</p>
                        <p><strong>Vitigni:</strong> {Array.isArray(item.vitigni) ? item.vitigni.join(", ") : item.vitigni}</p>
                        <p><strong>Gradazione:</strong> {item.gradazione}%</p>
                        {item.note_degustative && <p className="italic border-l-2 border-sea pl-3 mt-4">"{item.note_degustative}"</p>}
                     </div>
                  </div>
               ) : item.tipo === "cocktail" || item.base_alcolica ? (
                  <div className="mt-4 space-y-6">
                     <div className="text-center">
                        <Martini size={32} className="mx-auto text-amber-500/50 mb-2" />
                        <h2 className="text-3xl font-serif text-sea leading-tight">{name}</h2>
                        <p className="text-sm font-bold uppercase tracking-widest text-olive mt-2">{item.categoria_drink}</p>
                     </div>
                     <div className="bg-sand p-6 rounded-2xl text-sm text-olive space-y-3 relative overflow-hidden">
                        <Droplets className="absolute -bottom-4 -right-4 text-white opacity-40" size={100} />
                        <p><strong>Mix:</strong> {Array.isArray(item.ingredienti) ? item.ingredienti.join(", ") : item.ingredienti}</p>
                        {item.garnish && <p><strong>Garnish:</strong> {item.garnish}</p>}
                        {item.metodo && <p><strong>Tecnica:</strong> {item.metodo}</p>}
                        {item.note_assaggio && <p className="italic border-l-2 border-amber-500 pl-3 mt-4 text-amber-900/80">"{item.note_assaggio}"</p>}
                     </div>
                  </div>
               ) : (
                  <div className="mt-4 space-y-4">
                     <h2 className="text-3xl font-serif text-sea leading-tight pr-8">{name}</h2>
                     <p className="text-xl font-medium text-sea">€{item.prezzo || item.price}</p>
                     <p className="text-base text-olive leading-relaxed">{desc}</p>
                     {item.ingredienti && <p className="text-sm"><strong>Ingredienti:</strong> {Array.isArray(item.ingredienti) ? item.ingredienti.join(", ") : item.ingredienti}</p>}
                     {item.tecnica_cottura && <p className="text-sm"><strong>Tecnica:</strong> {item.tecnica_cottura}</p>}
                  </div>
               )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function AIChatSheet({ isOpen, onClose, menuContext, lang }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0 && isOpen) {
        setMessages([{ role: "assistant", text: "Ciao! Sono il tuo concierge MenuLive. Posso raccontarti un cocktail, farti parlare con il Sommelier AI dei nostri vini, o consigliarti un piatto. Cosa desideri?" }]);
    }
  }, [isOpen]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, isTyping]);

  const sendMessage = async () => {
    if (!input.trim() || isTyping || messages.length >= 20) return;
    
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setInput(""); setIsTyping(true);

    try {
      const fullMenuContext = (menuContext || []).map((m: any) => ({
        menuName: m.name, menuType: m.tipo,
        categories: (m.rawExtracted?.categories || []).map((c: any) => ({
          name: c.name,
          dishes: (m.rawExtracted?.dishesByCategoryId?.find((d: any) => d.categoryId === c.name.it)?.dishes || [])
        }))
      }));
      
      const simplifyMenuForAI = (menusCtx: any[]) => {
        return menusCtx.map(m => {
          return {
            menuName: m.menuName,
            menuType: m.menuType,
            categories: m.categories.map((c: any) => ({
               name: c.name,
               dishes: c.dishes.map((d: any) => {
                 const { rawImage, base64, ...rest } = d;
                 return rest;
               })
            }))
          };
        });
      };

      const response = await fetch("/api/customer/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, menuContext: simplifyMenuForAI(fullMenuContext), history: messages })
      });
      const data = await response.json();
      setMessages(prev => [...prev, { role: "assistant", text: data.text }]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-sea/20 backdrop-blur-sm z-40" />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed bottom-0 left-0 right-0 max-w-md mx-auto h-[80vh] bg-white rounded-t-[40px] z-50 flex flex-col border-t border-sand shadow-2xl">
            <div className="w-12 h-1 bg-olive/20 rounded-full mx-auto my-4 shrink-0" />
            
            <div className="px-6 py-4 flex justify-between items-center bg-sand/30 border-b border-sand/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sea rounded-full flex items-center justify-center text-white"><Sparkles size={20} /></div>
                <div>
                  <h4 className="font-serif text-sea">Concierge & Sommelier</h4>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span><span className="text-[10px] uppercase tracking-widest text-olive font-bold">Online</span></div>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-sand flex items-center justify-center text-olive hover:text-sea active:scale-90 transition-all"><X size={18} /></button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]">
              {messages.map((m, i) => (
                <div key={i} className={clsx("flex animate-in fade-in duration-500", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={clsx("max-w-[85%] p-4 rounded-2xl", m.role === "user" ? "bg-sea text-white rounded-br-none"  : "bg-sand/60 text-sea rounded-bl-none border border-sand")}>
                    <p className="text-sm leading-relaxed">{m.text}</p>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                   <div className="bg-sand/60 p-4 rounded-2xl rounded-bl-none border border-sand"><span className="animate-pulse">...</span></div>
                </div>
              )}
            </div>

            <div className="p-6 pt-2 bg-white pb-[env(safe-area-inset-bottom, 24px)] shrink-0">
              <div className="flex gap-2 bg-sand rounded-2xl p-2 border border-sand-dark/10 shadow-inner">
                <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Scrivi qui..." className="flex-1 bg-transparent px-3 py-2 outline-none text-sm font-medium" />
                <button onClick={sendMessage} disabled={!input.trim() || isTyping} className="w-10 h-10 bg-sea text-white rounded-xl flex items-center justify-center hover:bg-sea-light active:scale-90 transition-all disabled:opacity-50"><Send size={18} /></button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
