import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { auth, db, storage } from "../lib/firebase";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, where, orderBy, deleteDoc, serverTimestamp } from "firebase/firestore";
import { Plus, Upload, Save, Eye, QrCode, LogOut, Loader2, CheckCircle2, ChevronRight, Utensils, MessageSquare, Clock, MoreVertical, Edit2, Trash2, Globe } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import clsx from "clsx";
import { ChatAIRistoratore } from "../components/ChatAIRistoratore";

const getLocText = (field: any): string => {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field.it || field.en || field.fr || field.de || Object.values(field)[0] || "";
};

export default function OwnerDashboard() {
  const [restaurant, setRestaurant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [parsingMenu, setParsingMenu] = useState(false);
  const [parseStatus, setParseStatus] = useState("Carica Foto o PDF");
  const [menus, setMenus] = useState<any[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState("Menu Principale");
  const [newMenuType, setNewMenuType] = useState("ristorante");
  const [plans, setPlans] = useState<any[]>([]);
  const [dropdownState, setDropdownState] = useState<{ id: string, m: any, top: number, right: number } | null>(null);
  const [menuToDelete, setMenuToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDish, setEditingDish] = useState<any>(null);
  const [editingDishCategory, setEditingDishCategory] = useState<string | null>(null);

  const [isAddCatModalOpen, setIsAddCatModalOpen] = useState(false);
  const [newCatData, setNewCatData] = useState({ nameIt: "", position: "end", afterId: "" });
  const [translating, setTranslating] = useState(false);

  const handleRetranslateMenu = async () => {
    if (!activeMenuId || !restaurant || !menuData) return;
    if (!window.confirm("Vuoi tradurre AUTOMATICAMENTE tutti i piatti in EN, FR, DE? Questo sovrascriverà eventuali traduzioni esistenti (ci vorranno fino a 5 minuti).")) return;
    
    setTranslating(true);
    try {
      // 1. Gather all data
      const categories = menuData.categories.map((c: any) => ({
        id: c.id,
        name: c.name
      }));
      
      const dishesByCategoryId = menuData.categories.map((c: any) => ({
        categoryId: getLocText(c.name),
        dishes: c.dishes.map((d: any) => ({
          id: d.id,
          nome: d.nome || d.name,
          descrizione: d.descrizione || d.description
        }))
      }));

      // 2. Translate everything
      const resp = await fetch("/api/menu/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories, dishesByCategoryId })
      });
      
      if (!resp.ok) throw new Error("Errore comunicazione server");
      const translated = await resp.json();
      
      let count = 0;
      // 3. Update Firestore locally with permissions
      for (const cat of translated.categories) {
        if (cat.id && cat.name) {
          await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie`, cat.id), { name: cat.name });
          count++;
        }
      }
      
      for (const catGroup of translated.dishesByCategoryId) {
        // Find matching original category
        const originalCat = menuData.categories.find((c: any) => getLocText(c.name) === catGroup.categoryId);
        if (originalCat) {
          for (const dish of catGroup.dishes) {
            if (dish.id) {
               const updateData: any = {};
               if (dish.nome) updateData.nome = dish.nome;
               if (dish.descrizione) updateData.descrizione = dish.descrizione;
               if (Object.keys(updateData).length > 0) {
                 await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie/${originalCat.id}/piatti`, dish.id), updateData);
                 count++;
               }
            }
          }
        }
      }

      await fetchMenus(restaurant.id);
      alert(`Tradotti ${count} elementi con successo`);
    } catch (e: any) {
      alert("Errore traduzione: " + e.message);
    } finally {
      setTranslating(false);
    }
  };

  const getCategoryOrder = (menuTipo: string) => {
    const orders: Record<string, string[]> = {
      ristorante: ["ANTIPASTI", "PRIMI", "SECONDI", "CONTORNI", "DOLCI"],
      pizzeria: ["PIZZA", "CALZONI", "DOLCI"]
    };
    return orders[menuTipo] || [];
  };

  const sortCategories = (cats: any[], menuTipo: string) => {
    const order = getCategoryOrder(menuTipo);
    return [...cats].sort((a, b) => {
      const ia = order.indexOf(getLocText(a.name).toUpperCase());
      const ib = order.indexOf(getLocText(b.name).toUpperCase());
      const finalA = ia === -1 ? 999 : ia;
      const finalB = ib === -1 ? 999 : ib;
      return finalA - finalB;
    });
  };

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user) {
        fetchRestaurant();
      } else {
        setRestaurant(null);
        setMenus([]);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const fetchRestaurant = async () => {
    if (!auth.currentUser) return;
    const q = query(collection(db, "ristoranti"), where("ownerUid", "==", auth.currentUser.uid));
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      const resDoc = querySnapshot.docs[0];
      setRestaurant({ id: resDoc.id, ...resDoc.data() });
      fetchMenus(resDoc.id);
      fetchPlans(resDoc.id);
    }
    setLoading(false);
  };

  const [activeMenuData, setActiveMenuData] = useState<any>(null);

  const fetchMenus = async (restaurantId: string) => {
    const q = query(collection(db, `ristoranti/${restaurantId}/menus`));
    const snapshot = await getDocs(q);
    const menusList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // For each menu, fetch categories and dishes lightly to populate the UI properly
    for (const m of menusList) {
        const catSnap = await getDocs(collection(db, `ristoranti/${restaurantId}/menus/${m.id}/categorie`));
        m.categories = [];
        for (const catDoc of catSnap.docs) {
           const cData = { id: catDoc.id, ...catDoc.data() } as any;
           const itemSnap = await getDocs(collection(db, `ristoranti/${restaurantId}/menus/${m.id}/categorie/${cData.id}/piatti`));
           cData.dishes = itemSnap.docs.map(iDoc => ({ id: iDoc.id, ...iDoc.data() }));
           m.categories.push(cData);
        }
    }

    setMenus(menusList);
    
    // Automatically set active menu if none selected yet, or update the active menu data
    const newActiveId = activeMenuId && menusList.find(m => m.id === activeMenuId) ? activeMenuId : (menusList.length > 0 ? menusList[0].id : null);
    if (!activeMenuId && newActiveId) {
        setActiveMenuId(newActiveId);
    }
  };

  const fetchPlans = async (restaurantId: string) => {
    const q = query(collection(db, `ristoranti/${restaurantId}/pianificazioni`), where("stato", "==", "schedulato"));
    const snapshot = await getDocs(q);
    setPlans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
  };

  const menuData = menus.find(m => m.id === activeMenuId);

  const createRestaurant = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    
    const newRes = {
      name,
      ownerUid: auth.currentUser?.uid,
      activeLanguages: ["it", "en"],
      createdAt: new Date().toISOString(),
      palette: { primary: "#1a365d", secondary: "#f5f2ed" }
    };

    const docRef = await addDoc(collection(db, "ristoranti"), newRes);
    setRestaurant({ id: docRef.id, ...newRes });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !restaurant) return;

    setParsingMenu(true);
    setParseStatus("Sto leggendo l'immagine...");
    try {
      let base64Content = "";
      let mimeType = file.type;

      if (file.type === "application/pdf") {
         base64Content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
         });
      } else {
         const compressImage = (imageFile: File): Promise<string> => {
           return new Promise((resolve, reject) => {
             const img = new Image();
             img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width, height = img.height;
                const maxDim = 800;
                if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
                else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) return reject(new Error("Canvas not supported"));
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", 0.6));
             };
             img.onerror = reject; img.src = URL.createObjectURL(imageFile);
           });
         };
         base64Content = await compressImage(file);
         mimeType = "image/jpeg";
      }

      console.log("Inizio file parsing:", file.name, "Mime:", mimeType);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 300s timeout

      let response;
      try {
        setParseStatus("L'AI sta estraendo i piatti...");
        response = await fetch("/api/menu/parse-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileData: base64Content, mimeType, menuType: newMenuType }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        let errData = {};
        try { errData = await response.json(); } catch(e) {}
        throw new Error((errData as any).error || `Errore del server: ${response.status}`);
      }

      const extracted = await response.json();
      console.log("Parsing completion:", extracted);
      
      if (!extracted || !extracted.categories || extracted.categories.length === 0) {
        if (!extracted.domande_di_chiarimento || extracted.domande_di_chiarimento.length === 0) {
           throw new Error("L'AI non è riuscita a identificare categorie.");
        }
      }

      // Save to Firestore
      const menuRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus`), {
        name: newMenuName,
        tipo: newMenuType,
        isPublished: false,
        createdAt: new Date().toISOString(),
        rawExtracted: extracted
      });

      // Create categories and dishes
      for (const cat of extracted.categories) {
        const catRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus/${menuRef.id}/categorie`), {
          name: cat.name,
          order: 0
        });
        
        const relevantDishes = extracted.dishesByCategoryId?.find((d: any) => d.categoryId?.toLowerCase().trim() === cat.name?.it?.toLowerCase().trim())?.dishes || [];
        for (const dish of relevantDishes) {
          await addDoc(collection(db, `ristoranti/${restaurant.id}/menus/${menuRef.id}/categorie/${catRef.id}/piatti`), {
            ...dish,
            isAvailable: true
          });
        }
      }

      await fetchMenus(restaurant.id);

      // Trigger Onboarding Chat BEFORE setting active menu
      setParseStatus("Traduzione in corso...");
      await triggerOnboardingChat(menuRef.id, extracted);
      
      setActiveMenuId(menuRef.id);

    } catch (error: any) {
      console.error(error);
      if (error.name === "AbortError") {
         alert("Il parsing sta impiegando troppo, riprova con una foto più chiara o resize dell'immagine.");
      } else if (error.message?.includes("Failed to fetch") || error.message?.includes("NetworkError")) {
         alert("Errore di rete o timeout (Failed to fetch). Il server ha impiegato troppo a rispondere. Riprova o usa un menu più corto.");
      } else {
         alert(error.message || "Errore durante il parsing del menu.");
      }
    } finally {
      setParsingMenu(false);
      setParseStatus("Carica Foto o PDF");
    }
  };

  const triggerOnboardingChat = async (menuId: string, extracted: any) => {
    if (!restaurant) return;
    try {
      const resp = await fetch("/api/owner/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurant.id,
          menuId,
          trigger: "post_parsing",
          parse_result: {
            num_piatti_estratti: extracted.dishesByCategoryId?.reduce((acc: number, curr: any) => acc + (curr.dishes?.length || 0), 0) || 0,
            num_categorie: extracted.categories?.length || 0,
            categorie_riepilogo: extracted.categories?.map((c: any) => c.name.it),
            domande_di_chiarimento: extracted.domande_di_chiarimento || [],
            piatti_dettaglio: extracted.dishesByCategoryId?.map((cat: any) => ({
              categoria: cat.categoryId,
              piatti: cat.dishes?.map((d: any) => ({
                nome: d.name?.it || d.nome?.it || "MANCANTE",
                prezzo: d.price ?? d.prezzo ?? "MANCANTE",
                ingredienti_estratti: d.ingredients?.length || d.ingredienti?.length || 0,
                allergeni_estratti: d.allergens?.length || d.allergeni?.length || 0,
                tecnica_estratta: !!(d.cooking_technique || d.tecnica_cottura),
                descrizione_estratta: !!(d.description?.it || d.descrizione?.it),
                is_frozen: d.is_frozen,
                price_note: d.price_note
              }))
            })),
            campi_critici_mancanti: extracted.dishesByCategoryId?.flatMap((cat: any) => 
              cat.dishes?.filter((d: any) => !(d.name?.it || d.nome?.it) || (d.price === undefined && d.prezzo === undefined)).map((d: any) => ({
                categoria: cat.categoryId,
                nome: d.name?.it || d.nome?.it || "SENZA NOME",
                mancanti: [
                  !(d.name?.it || d.nome?.it) && "nome",
                  (d.price === undefined && d.prezzo === undefined) && "prezzo"
                ].filter(Boolean)
              }))
            ).filter((d: any) => d.mancanti.length > 0) || []
          }
        })
      });
      const data = await resp.json();

      if (!data.text || typeof data.text !== "string" || data.text.trim() === "") {
        console.error("Onboarding fallito: AI non ha generato testo", data);
        const totalPiatti = extracted.dishesByCategoryId?.reduce((acc: number, c: any) => acc + (c.dishes?.length || 0), 0) || 0;
        const fallbackText = `Ho caricato il tuo menu con ${totalPiatti} piatti. Mi è successo un problema temporaneo nel generare il riepilogo dettagliato. Puoi chiedermi cose specifiche o cliccare "+" per aggiungere/modificare piatti manualmente.`;
        await addDoc(collection(db, `ristoranti/${restaurant.id}/chat_history/${menuId}/messaggi`), {
          role: "assistant",
          text: fallbackText,
          createdAt: serverTimestamp()
        });
        return;
      }
      
      // Save the pro-active message to Firestore so it appears on refresh
      await addDoc(collection(db, `ristoranti/${restaurant.id}/chat_history/${menuId}/messaggi`), {
        role: "assistant",
        text: data.text,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error("Trigger Onboarding Error:", e);
    }
  };

  const handleCreateEmptyMenu = async () => {
    if (!restaurant) return;
    try {
      const menuRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus`), {
        name: newMenuName,
        tipo: newMenuType,
        isPublished: false,
        createdAt: new Date().toISOString()
      });
      await fetchMenus(restaurant.id);
      setActiveMenuId(menuRef.id);
    } catch (e: any) {
      alert("Errore: " + e.message);
    }
  };

  const handleCreateWithAI = async () => {
    if (!restaurant) return;
    try {
      const menuRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus`), {
        name: newMenuName,
        tipo: newMenuType,
        isPublished: false,
        createdAt: new Date().toISOString()
      });
      await fetchMenus(restaurant.id);
      setActiveMenuId(menuRef.id);
      
      const welcomeMsg = { 
        role: "assistant", 
        text: `Iniziamo a costruire il tuo menu "${newMenuName}". Dimmi quali categorie vuoi (es. Antipasti, Primi, Secondi, Pizze, Dolci) e dopo ti chiederò i piatti uno per uno.`, 
        createdAt: serverTimestamp() 
      };
      await addDoc(collection(db, `ristoranti/${restaurant.id}/chat_history/${menuRef.id}/messaggi`), welcomeMsg);
    } catch (e: any) {
      alert("Errore: " + e.message);
    }
  };

  const handleDirectAction = async (action: any) => {
     try {
        const { type, target, updates } = action;
        const mId = target?.menuId || activeMenuId;
        if (!mId) return false;
        
        const catId = target?.categoriaId;
        const itemId = target?.itemId;
        
        if (type === "direct_update") {
            if (itemId && catId) {
                await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${catId}/piatti`, itemId), updates);
            } else if (catId) {
                await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie`, catId), updates);
            } else {
                await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus`, mId), updates);
            }
        } 
        else if (type === "direct_delete") {
            if (itemId && catId) {
                await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${catId}/piatti`, itemId));
            } else if (catId) {
                const itemsSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${catId}/piatti`));
                for (const itemDoc of itemsSnap.docs) {
                    await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${catId}/piatti`, itemDoc.id));
                }
                await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie`, catId));
            } else {
                // Delete entire menu
                const catSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie`));
                for (const cDoc of catSnap.docs) {
                    const iSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${cDoc.id}/piatti`));
                    for (const iDoc of iSnap.docs) {
                        await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${cDoc.id}/piatti`, iDoc.id));
                    }
                    await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie`, cDoc.id));
                }
                await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus`, mId));
                
                const plansSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/pianificazioni`));
                for (const pDoc of plansSnap.docs) {
                    if (pDoc.data().target?.menuId === mId) {
                        await deleteDoc(doc(db, `ristoranti/${restaurant.id}/pianificazioni`, pDoc.id));
                    }
                }
                if (activeMenuId === mId) {
                   const remaining = menus.filter(m => m.id !== mId);
                   setActiveMenuId(remaining.length > 0 ? remaining[0].id : null);
                }
            }
        }
        else if (type === "direct_create") {
            let actualCatId = catId;
            if (!actualCatId || actualCatId === "new") {
                const catParams = updates.categoria || { name: "Nuova Categoria", position: 0 };
                const newCatRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie`), catParams);
                actualCatId = newCatRef.id;
            }
            if (updates.name || updates.nome) { // it's an item
               const itemData = { ...updates };
               delete itemData.categoria; // clean up if nested
               if (!itemData.price) itemData.price = 0;
               await addDoc(collection(db, `ristoranti/${restaurant.id}/menus/${mId}/categorie/${actualCatId}/piatti`), itemData);
            }
        }
        
        await fetchMenus(restaurant.id);
        return true;
     } catch (e: any) {
        console.error("Direct Action Error:", e);
        throw new Error(e.message || "Errore durante l'esecuzione dell'azione");
     }
  };

  const handleRenameMenu = async (menu: any) => {
    const newName = window.prompt("Nuovo nome del menu:", menu.name);
    if (newName && newName.trim() !== "") {
        await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus`, menu.id), { name: newName.trim() });
        fetchMenus(restaurant.id);
    }
  };

  const confirmDeleteMenu = async () => {
     if (!menuToDelete) return;
     setIsDeleting(true);
     try {
       const menuId = menuToDelete.id;
       const catSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/menus/${menuId}/categorie`));
       for (const catDoc of catSnap.docs) {
          const itemsSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/menus/${menuId}/categorie/${catDoc.id}/piatti`));
          for (const itemDoc of itemsSnap.docs) {
             await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${menuId}/categorie/${catDoc.id}/piatti`, itemDoc.id));
          }
          await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${menuId}/categorie`, catDoc.id));
       }
       await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus`, menuId));
       
       const plansSnap = await getDocs(collection(db, `ristoranti/${restaurant.id}/pianificazioni`));
       for (const planDoc of plansSnap.docs) {
          if (planDoc.data().target?.menuId === menuId) {
             await deleteDoc(doc(db, `ristoranti/${restaurant.id}/pianificazioni`, planDoc.id));
          }
       }

       alert("Menu eliminato");
       const remaining = menus.filter(m => m.id !== menuId);
       setMenus(remaining);
       if (activeMenuId === menuId) {
          setActiveMenuId(remaining.length > 0 ? remaining[0].id : null);
       }
       await fetchPlans(restaurant.id);
     } catch (e: any) {
       console.error("Delete Error:", e);
       alert("Errore durante l'eliminazione: " + e.message);
     } finally {
       setIsDeleting(false);
       setMenuToDelete(null);
     }
  };

  const handleManualAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant || !activeMenuId || !newCatData.nameIt) return;
    
    try {
      let order = 0;
      const cats = menuData?.categories || [];
      
      if (newCatData.position === "start") {
        order = cats.length > 0 ? Math.min(...cats.map((c: any) => c.order || 0)) - 1 : 0;
      } else if (newCatData.position === "end") {
        order = cats.length > 0 ? Math.max(...cats.map((c: any) => c.order || 0)) + 1 : 0;
      } else if (newCatData.position === "after" && newCatData.afterId) {
        const afterCat = cats.find((c: any) => c.id === newCatData.afterId);
        order = (afterCat?.order || 0) + 0.5;
      }

      const nameObj = { it: newCatData.nameIt, en: "", fr: "", de: "" };
      
      const catRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie`), {
        name: nameObj,
        order: order
      });

      // Auto translate category name
      fetch("/api/menu/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: [{ name: nameObj }], dishesByCategoryId: [] })
      }).then(r => r.json()).then(async (translated) => {
        if (translated.categories?.[0]?.name) {
          await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie`, catRef.id), {
            name: translated.categories[0].name
          });
          fetchMenus(restaurant.id);
        }
      }).catch(console.error);

      setIsAddCatModalOpen(false);
      setNewCatData({ nameIt: "", position: "end", afterId: "" });
      await fetchMenus(restaurant.id);
    } catch (error: any) {
      alert("Errore: " + error.message);
    }
  };

  const handleSaveDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant || !activeMenuId || !editingDish || !editingDishCategory) return;
    
    if (!((typeof editingDish.nome === "object" ? editingDish.nome?.it : editingDish.nome) || (typeof editingDish.name === "object" ? editingDish.name?.it : editingDish.name))) {
      alert("Il nome (IT) è obbligatorio"); return;
    }
    if ((editingDish.prezzo === undefined || editingDish.prezzo === null) && (editingDish.price === undefined || editingDish.price === null)) {
      alert("Il prezzo è obbligatorio"); return;
    }

    try {
      const isNew = !editingDish.id;
      const { id, ...dataToSave } = editingDish;
      
      let finalDishId = id;

      if (isNew) {
        const docRef = await addDoc(collection(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie/${editingDishCategory}/piatti`), {
          ...dataToSave,
          isAvailable: true,
          createdAt: new Date().toISOString()
        });
        finalDishId = docRef.id;
      } else {
        await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie/${editingDishCategory}/piatti`, id), dataToSave);
      }

      // Background translation for new dish
      if (isNew) {
        const cat = menuData.categories.find((c: any) => c.id === editingDishCategory);
        fetch("/api/menu/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            categories: [{ name: cat.name }], 
            dishesByCategoryId: [{ categoryId: getLocText(cat.name), dishes: [dataToSave] }] 
          })
        }).then(r => r.json()).then(async (result) => {
           const translated = result.dishesByCategoryId?.[0]?.dishes?.[0];
           if (translated) {
             await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie/${editingDishCategory}/piatti`, finalDishId), translated);
             fetchMenus(restaurant.id);
           }
        }).catch(console.error);
      }

      setIsEditModalOpen(false);
      setEditingDish(null);
      setEditingDishCategory(null);
      await fetchMenus(restaurant.id);
    } catch (error: any) {
      alert("Errore salvataggio: " + error.message);
    }
  };

  const handleToggleDishAvailability = async (catId: string, dish: any) => {
    if (!restaurant || !activeMenuId) return;
    
    try {
      const isCurrentlyAvailable = dish.isAvailable !== false;
      await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie/${catId}/piatti`, dish.id), {
        isAvailable: !isCurrentlyAvailable
      });
      await fetchMenus(restaurant.id);
    } catch (error: any) {
      alert("Errore aggiornamento disponibilità: " + error.message);
    }
  };

  const handleDeleteDish = async (catId: string, dish: any) => {
    if (!restaurant || !activeMenuId) return;
    if (!window.confirm(`Sei sicuro di voler eliminare "${dish.nome?.it || dish.name?.it || "questo piatto"}"?`)) return;
    
    try {
      await deleteDoc(doc(db, `ristoranti/${restaurant.id}/menus/${activeMenuId}/categorie/${catId}/piatti`, dish.id));
      await fetchMenus(restaurant.id);
    } catch (error: any) {
      alert("Errore eliminazione: " + error.message);
    }
  };

  if (loading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;

  if (!restaurant) {
    return (
      <div className="max-w-xl mx-auto p-8 pt-24 text-center">
        <h1 className="text-3xl font-serif mb-4">Benvenuto su MenuLive</h1>
        <p className="text-olive mb-8">Iniziamo configurando il profilo del tuo ristorante.</p>
        <form onSubmit={createRestaurant} className="bg-white p-8 rounded-3xl shadow-sm border border-sand">
          <input name="name" placeholder="Nome del Ristorante" className="w-full p-4 rounded-xl border border-sand bg-sand/20 mb-4 outline-none" required />
          <button type="submit" className="w-full btn-primary">Crea Profilo</button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8">
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-serif text-sea">{restaurant.name}</h1>
          <p className="text-olive">Piattaforma di Gestione Menu</p>
        </div>
        <button onClick={() => auth.signOut()} className="p-2 text-olive hover:text-sea transition-all">
          <LogOut size={24} />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Col: Upload & Active Plans & Chat */}
        <div className="lg:col-span-1 space-y-6">
          <div className="coastal-card p-6">
            <h2 className="text-xl font-serif mb-4 flex items-center gap-2">
              <Upload className="text-sea" size={20} /> Nuovo Menu
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-olive block mb-1">Nome</label>
                <input type="text" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} className="w-full p-2.5 rounded-xl border border-sand bg-white outline-none focus:border-sea transition-all text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-olive block mb-1">Tipo Menu</label>
                <select value={newMenuType} onChange={e => setNewMenuType(e.target.value)} className="w-full p-2.5 rounded-xl border border-sand bg-white outline-none focus:border-sea transition-all text-sm">
                   <option value="ristorante">Ristorante</option>
                   <option value="pizzeria">Pizzeria</option>
                   <option value="carta_vini">Carta Vini</option>
                   <option value="cocktail">Cocktail Bar</option>
                   <option value="bar">Bar Semplice</option>
                </select>
              </div>
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-sand rounded-2xl cursor-pointer hover:bg-sand/30 transition-all">
                <div className="flex flex-col items-center justify-center">
                  {parsingMenu ? <Loader2 className="animate-spin text-sea mb-1" size={24} /> : <Upload className="text-olive mb-1" size={24} />}
                  <span className="text-xs text-sea font-medium text-center px-2">{parseStatus}</span>
                </div>
                <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={parsingMenu} />
              </label>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sand"></div></div>
                <div className="relative flex justify-center"><span className="bg-[#fdfbf7] px-2 text-[10px] uppercase font-bold text-olive">Oppure</span></div>
              </div>

              <div className="flex flex-col gap-2">
                <button 
                  onClick={handleCreateEmptyMenu} 
                  className="w-full py-2 bg-sand/30 hover:bg-sand/50 text-olive text-xs font-semibold rounded-xl border border-sand transition-all text-center">
                  Inizia da zero
                </button>
                <button 
                  onClick={handleCreateWithAI} 
                  className="w-full py-2 bg-sea/10 hover:bg-sea/20 text-sea text-xs font-semibold rounded-xl border border-sea/20 transition-all text-center flex items-center justify-center gap-2">
                  <MessageSquare size={14} /> Crea con Chat AI
                </button>
              </div>
            </div>
          </div>

          <div className="coastal-card p-6 border border-sea/10">
              <h2 className="text-xl font-serif mb-4 flex items-center gap-2 text-sea"><Clock size={20} /> Pianificazioni</h2>
              {plans.length === 0 ? (
                  <p className="text-xs text-olive italic">Nessun cambio schedulato.</p>
              ) : (
                  <ul className="space-y-2">
                     {plans.map(p => (
                         <li key={p.id} className="bg-sand/30 p-2 border border-sand rounded-xl text-xs flex justify-between items-start">
                             <div><span className="font-semibold block">{new Date(p.trigger_datetime).toLocaleDateString()}</span> {p.descritto_come}</div>
                             <button onClick={() => deleteDoc(doc(db, `ristoranti/${restaurant.id}/pianificazioni`, p.id)).then(()=>fetchPlans(restaurant.id))} className="text-red-500 font-bold px-1 hover:bg-red-50 rounded">X</button>
                         </li>
                     ))}
                  </ul>
              )}
          </div>
          
          <ChatAIRistoratore 
            restaurantId={restaurant.id} 
            activeMenu={menuData}
            menus={menus}
            activePlans={plans} 
            onPlanAdded={() => fetchPlans(restaurant.id)} 
            onDirectAction={handleDirectAction} 
          />
        </div>

        {/* Right Col: Menus Management */}
        <div className="lg:col-span-3 space-y-6">
          <div className="coastal-card p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-serif">Gestione Menu</h2>
                <div className="mt-2 flex items-center gap-2 text-sm text-olive">
                   <span>Link pubblico:</span>
                   <a href={`/menu/${restaurant.id}`} target="_blank" className="text-sea hover:underline font-medium">
                     {`${window.location.host}/menu/${restaurant.id}`}
                   </a>
                </div>
              </div>
              
              {menuData && (
                <div className="flex flex-wrap items-center gap-4">
                   <div className="bg-white p-2 rounded-xl shadow-sm border border-sand flex items-center gap-4 pr-6">
                      <div className="bg-white p-1 rounded-lg border border-sand">
                         <QRCodeSVG value={`${window.location.origin}/menu/${restaurant.id}`} size={48} />
                      </div>
                      <div className="text-sm font-medium text-olive">
                         Inquadra col<br/>telefono
                      </div>
                   </div>
                   <a href={`/menu/${restaurant.id}`} target="_blank" className="btn-secondary py-2 flex items-center gap-2 text-sm bg-sea hover:bg-sea-light text-white border-0 transition-colors">
                      <Eye size={18} /> Apri Menu Pubblico
                   </a>
                </div>
              )}
            </div>

                      <div className="flex gap-2 mb-6 overflow-x-auto pb-4 mb-4 border-b border-sand scrollbar-none">
                        <button 
                          onClick={() => setIsAddCatModalOpen(true)}
                          className="px-4 py-2 bg-sea/10 text-sea hover:bg-sea/20 rounded-xl text-xs font-bold border border-dashed border-sea/30 whitespace-nowrap flex items-center gap-2"
                        >
                          <Plus size={14} /> Nuova Categoria
                        </button>
                  {menus.map((m) => (
                  <div key={m.id} className="relative flex group">
                    <button onClick={() => setActiveMenuId(m.id)} className={clsx("px-4 py-2 rounded-l-xl text-sm font-medium transition-all whitespace-nowrap flex items-center gap-2", activeMenuId === m.id ? "bg-sea text-white" : "bg-sand/30 text-olive hover:bg-sand/50")}>
                      {m.name || "Senza Titolo"} <span className="opacity-50 text-[10px] uppercase">{m.tipo}</span>
                    </button>
                    <button onClick={(e) => { 
                      e.stopPropagation(); 
                      if (dropdownState?.id === m.id) {
                         setDropdownState(null);
                      } else {
                         const rect = e.currentTarget.getBoundingClientRect();
                         setDropdownState({ id: m.id, m: m, top: rect.bottom + 4, right: window.innerWidth - rect.right });
                      }
                    }} className={clsx("px-2 py-2 rounded-r-xl transition-all border-l border-sand/10", activeMenuId === m.id ? "bg-sea text-white hover:bg-sea-light border-white/20" : "bg-sand/30 text-olive hover:bg-sand/50")}>
                      <MoreVertical size={14} />
                    </button>
                  </div>
                ))}
                  {menus.length > 0 && (
                    <button 
                      onClick={handleRetranslateMenu}
                      disabled={translating}
                      className="px-4 py-2 bg-sand/30 text-olive hover:bg-sand/50 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 disabled:opacity-50"
                    >
                      {translating ? <Loader2 className="animate-spin" size={14} /> : <Globe size={14} />} 
                      {translating ? "Traduzione in corso..." : "Ritraduci Menu"}
                    </button>
                  )}
                </div>

            {dropdownState && createPortal(
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setDropdownState(null)}></div>
                <div 
                  className="fixed bg-white rounded-xl shadow-lg border border-sand py-1 z-[70] w-40"
                  style={{ top: dropdownState.top, right: dropdownState.right }}
                >
                  <button onClick={(e) => { e.stopPropagation(); setDropdownState(null); handleRenameMenu(dropdownState.m); }} className="w-full px-4 py-2 text-left text-sm text-olive hover:bg-sand flex items-center gap-2"><Edit2 size={14}/> Rinomina menu</button>
                  <button onClick={(e) => { e.stopPropagation(); setDropdownState(null); setMenuToDelete(dropdownState.m); }} className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={14}/> Elimina menu</button>
                </div>
              </>,
              document.body
            )}
            
            {!menuData ? (
              <div className="text-center py-12 text-olive bg-sand/20 rounded-2xl border border-dashed border-sand">
                Seleziona o crea un menu a sinistra.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-sand">
                   <div>
                      <p className="font-bold flex items-center gap-2">Stato: <span className={clsx("px-2 py-0.5 rounded-md text-[10px]", menuData.isPublished ? "bg-green-100 text-green-700" : "bg-sand text-olive")}>{menuData.isPublished ? "PUBBLICATO" : "BOZZA"}</span></p>
                      <p className="text-xs text-olive mt-1">Imposta se visibile per i clienti ai tavoli.</p>
                   </div>
                   <button onClick={async () => { await updateDoc(doc(db, `ristoranti/${restaurant.id}/menus`, menuData.id), { isPublished: !menuData.isPublished }); fetchMenus(restaurant.id); }} className={clsx("px-4 py-2 rounded-lg font-medium transition-all text-sm", menuData.isPublished ? "bg-orange-50 text-orange-600 border border-orange-200" : "bg-green-50 text-green-600 border border-green-200")}>
                     {menuData.isPublished ? "Sospendi" : "Pubblica"}
                   </button>
                </div>

                <div className="space-y-8 mt-6">
                  <h3 className="font-serif text-2xl text-sea border-b border-sand pb-2">Categorie e Prodotti ({menuData.tipo})</h3>
                  
                  {menuData.categories?.length === 0 ? (
                    <div className="text-center py-8 text-olive bg-sand/10 rounded-2xl border border-dashed border-sand">
                       Questo menu è vuoto. Aggiungi piatti dalla chat AI a destra, oppure dal bottone "+ Aggiungi categoria" qui sopra.
                    </div>
                  ) : (
                    <div className="space-y-12">
                      {sortCategories(menuData.categories || [], menuData.tipo).map((cat: any) => (
                        <section key={cat.id} className="space-y-4">
                          <div className="flex justify-between items-end border-b border-sand/50 pb-2">
                             <h4 className="font-serif text-xl text-olive uppercase tracking-tight">{getLocText(cat.name)}</h4>
                             <span className="text-[10px] font-bold text-olive/40 uppercase tracking-widest">{cat.dishes?.length || 0} Prodotti</span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {(cat.dishes || []).map((d: any) => (
                              <div key={d.id} className="group bg-white border border-sand p-5 rounded-2xl flex flex-col gap-3 shadow-sm hover:shadow-md transition-all relative">
                                <div className="flex justify-between items-start gap-2">
                                   <div className="flex-1">
                                      <div className="flex items-start justify-between gap-2">
                                         <p className={`font-serif text-base leading-tight text-sea group-hover:text-sea-light transition-colors ${d.isAvailable === false ? 'opacity-50 line-through' : ''}`}>
                                             {getLocText(d.nome || d.name) || "Senza Nome"}
                                         </p>
                                         <button
                                             onClick={(e) => { e.stopPropagation(); handleToggleDishAvailability(cat.id, d); }}
                                             className={`mt-1 relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${d.isAvailable !== false ? 'bg-sea' : 'bg-sand cursor-pointer'}`}
                                             title={d.isAvailable !== false ? "Disponibile" : "Esaurito"}
                                         >
                                             <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${d.isAvailable !== false ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                                         </button>
                                      </div>
                                      <p className="text-[11px] text-olive/60 mt-1 uppercase font-bold tracking-tighter">€ {d.prezzo ?? d.price ?? "N.D."}</p>
                                   </div>
                                   <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button 
                                        onClick={() => { setEditingDish(d); setEditingDishCategory(cat.id); setIsEditModalOpen(true); }}
                                        className="p-1.5 text-olive hover:bg-sand rounded-lg transition-colors"
                                        title="Modifica"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteDish(cat.id, d)}
                                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Elimina"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                   </div>
                                </div>
                                <p className="text-xs text-olive/80 line-clamp-2 leading-relaxed h-8">
                                  {getLocText(d.descrizione || d.description || d.cantina || d.note_degustative)}
                                </p>
                                
                                <div className="flex flex-wrap gap-1 mt-auto">
                                   {(d.ingredienti || d.ingredients)?.slice(0, 3).map((ing: string, idx: number) => (
                                     <span key={idx} className="px-1.5 py-0.5 bg-sand/30 text-olive/60 rounded text-[9px] uppercase font-medium">{ing}</span>
                                   ))}
                                   {(d.allergeni || d.allergens)?.length > 0 && (
                                     <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-[9px] uppercase font-bold">! Allergeni</span>
                                   )}
                                </div>
                              </div>
                            ))}
                            {(!cat.dishes || cat.dishes.length === 0) && (
                              <div className="col-span-full py-4 text-center text-xs text-olive/50 border border-dashed border-sand rounded-xl italic">
                                Nessun piatto in questa categoria.
                              </div>
                            )}

                            {/* Manual Add Dish Card */}
                            <button 
                              onClick={() => {
                                const emptyDish: any = {
                                  nome: { it: "", en: "", fr: "", de: "" },
                                  descrizione: { it: "", en: "", fr: "", de: "" },
                                  prezzo: null,
                                  isAvailable: true
                                };
                                // Adapt to menu type
                                if (menuData.tipo === "carta_vini") {
                                  emptyDish.cantina = ""; emptyDish.annata = null; emptyDish.vitigni = [];
                                } else if (menuData.tipo === "cocktail") {
                                  emptyDish.base_alcolica = ""; emptyDish.ingredienti = [];
                                }
                                setEditingDish(emptyDish);
                                setEditingDishCategory(cat.id);
                                setIsEditModalOpen(true);
                              }}
                              className="group border-2 border-dashed border-sand hover:border-sea/30 hover:bg-sea/5 p-5 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all min-h-[140px]"
                            >
                               <div className="w-10 h-10 rounded-full bg-sand/30 group-hover:bg-sea/10 flex items-center justify-center transition-colors">
                                  <Plus className="text-olive/40 group-hover:text-sea" size={20} />
                               </div>
                               <span className="text-xs font-bold text-olive/40 group-hover:text-sea uppercase tracking-wider">Aggiungi Piatto</span>
                            </button>
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add/Edit Dish Modal */}
      {isEditModalOpen && editingDish && (
        <div className="fixed inset-0 bg-sea/40 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
          <form onSubmit={handleSaveDish} className="bg-white rounded-3xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-serif text-sea mb-6 flex items-center gap-2">
              {editingDish.id ? <Edit2 size={20} /> : <Plus size={20} />} 
              {editingDish.id ? "Modifica Prodotto" : "Nuovo Prodotto"}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Nome (IT) *</label>
                  <input 
                    type="text" 
                    value={typeof editingDish.nome === "string" ? editingDish.nome : (editingDish.nome?.it || editingDish.name?.it || "")} 
                    onChange={e => setEditingDish({
                      ...editingDish, 
                      nome: typeof editingDish.nome === "object" ? { ...editingDish.nome, it: e.target.value } : { it: e.target.value },
                      name: typeof editingDish.name === "object" ? { ...editingDish.name, it: e.target.value } : { it: e.target.value } 
                    })} 
                    className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none focus:ring-2 focus:ring-sea/20" 
                    required 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Prezzo (€) *</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editingDish.prezzo ?? editingDish.price ?? ""} 
                    onChange={e => setEditingDish({
                      ...editingDish, 
                      prezzo: parseFloat(e.target.value),
                      price: parseFloat(e.target.value)
                    })} 
                    className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none" 
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Descrizione (IT)</label>
                  <textarea 
                    rows={4}
                    value={typeof editingDish.descrizione === "string" ? editingDish.descrizione : (editingDish.descrizione?.it || editingDish.description?.it || "")} 
                    onChange={e => setEditingDish({
                      ...editingDish, 
                      descrizione: typeof editingDish.descrizione === "object" ? { ...editingDish.descrizione, it: e.target.value } : { it: e.target.value },
                      description: typeof editingDish.description === "object" ? { ...editingDish.description, it: e.target.value } : { it: e.target.value }
                    })} 
                    className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm"
                  />
                </div>
              </div>
              
              <div className="space-y-4">
                {/* Adaptive Fields based on Menu Type */}
                {menuData.tipo === "carta_vini" ? (
                  <>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Cantina</label>
                      <input type="text" value={editingDish.cantina || ""} onChange={e => setEditingDish({...editingDish, cantina: e.target.value})} className="w-full p-3 rounded-xl border border-sand bg-sand/10 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Annata</label>
                      <input type="number" value={editingDish.annata || ""} onChange={e => setEditingDish({...editingDish, annata: parseInt(e.target.value)})} className="w-full p-3 rounded-xl border border-sand bg-sand/10 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Zona / Vitigni</label>
                      <input type="text" value={editingDish.zona || ""} onChange={e => setEditingDish({...editingDish, zona: e.target.value})} className="w-full p-3 rounded-xl border border-sand bg-sand/10 text-sm outline-none mb-2" placeholder="Zona" />
                      <input type="text" value={(editingDish.vitigni || []).join(", ")} onChange={e => setEditingDish({...editingDish, vitigni: e.target.value.split(',').map(v=>v.trim())})} className="w-full p-3 rounded-xl border border-sand bg-sand/10 text-sm outline-none" placeholder="Vitigni (Separati da virgola)" />
                    </div>
                  </>
                ) : menuData.tipo === "cocktail" ? (
                  <>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Base Alcolica</label>
                      <input type="text" value={editingDish.base_alcolica || ""} onChange={e => setEditingDish({...editingDish, base_alcolica: e.target.value})} className="w-full p-3 rounded-xl border border-sand bg-sand/10 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Ingredienti Drink</label>
                      <input type="text" value={(editingDish.ingredienti || []).join(", ")} onChange={e => setEditingDish({...editingDish, ingredienti: e.target.value.split(',').map(v=>v.trim())})} className="w-full p-3 rounded-xl border border-sand bg-sand/10 text-sm outline-none line-clamp-1" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Ingredienti (Comma separated)</label>
                      <input 
                        type="text" 
                        value={(editingDish.ingredienti || editingDish.ingredients || []).join(", ")} 
                        onChange={e => {
                          const ings = e.target.value.split(",").map(i => i.trim()).filter(i => i !== "");
                          setEditingDish({ ...editingDish, ingredienti: ings, ingredients: ings });
                        }} 
                        className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm"
                        placeholder="Esempio: Pomodoro, Mozzarella, Basilico"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Allergeni (Comma separated)</label>
                      <input 
                        type="text" 
                        value={(editingDish.allergeni || editingDish.allergens || []).join(", ")} 
                        onChange={e => {
                          const alls = e.target.value.split(",").map(i => i.trim()).filter(i => i !== "");
                          setEditingDish({ ...editingDish, allergeni: alls, allergens: alls });
                        }} 
                        className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm"
                        placeholder="Esempio: Glutine, Lattosio"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-olive mb-1 block">Tecnica di Cottura</label>
                      <input 
                        type="text" 
                        value={editingDish.tecnica_cottura || editingDish.cooking_technique || ""} 
                        onChange={e => setEditingDish({ ...editingDish, tecnica_cottura: e.target.value, cooking_technique: e.target.value })} 
                        className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center gap-2 pt-4">
                  <input 
                    type="checkbox" 
                    id="is_frozen"
                    checked={editingDish.is_frozen || false} 
                    onChange={e => setEditingDish({ ...editingDish, is_frozen: e.target.checked })}
                    className="w-4 h-4 rounded border-sand text-sea focus:ring-sea"
                  />
                  <label htmlFor="is_frozen" className="text-xs font-bold uppercase tracking-wider text-olive">Prodotto Surgelato</label>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end mt-8 border-t border-sand pt-6">
              <button 
                type="button" 
                onClick={() => { setIsEditModalOpen(false); setEditingDish(null); }} 
                className="px-6 py-2.5 border border-sand text-olive rounded-xl hover:bg-sand/30 font-medium transition-all"
              >
                Annulla
              </button>
              <button 
                type="submit" 
                className="px-6 py-2.5 bg-sea text-white rounded-xl hover:bg-sea-light transition-all font-medium flex items-center gap-2"
              >
                <Save size={18} /> {editingDish.id ? "Salva Modifiche" : "Salva"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Category Modal */}
      {isAddCatModalOpen && (
        <div className="fixed inset-0 bg-sea/40 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
          <form onSubmit={handleManualAddCategory} className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-serif text-sea mb-6 flex items-center gap-2">
              <Plus size={20} /> Nuova Categoria
            </h3>
            
            <div className="space-y-4">
               <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-olive block mb-1">Nome Categoria (IT)</label>
                  <input 
                    type="text" 
                    value={newCatData.nameIt} 
                    onChange={e => setNewCatData({...newCatData, nameIt: e.target.value})} 
                    className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm" 
                    placeholder="es. Antipastoni"
                    required 
                  />
               </div>
               <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-olive block mb-1">Posizione</label>
                  <select 
                    value={newCatData.position} 
                    onChange={e => setNewCatData({...newCatData, position: e.target.value})}
                    className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm"
                  >
                    <option value="start">In cima</option>
                    <option value="end">In fondo</option>
                    <option value="after">Dopo una categoria esistente</option>
                  </select>
               </div>
               {newCatData.position === "after" && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-olive block mb-1">Dopo quale?</label>
                    <select 
                      value={newCatData.afterId} 
                      onChange={e => setNewCatData({...newCatData, afterId: e.target.value})}
                      className="w-full p-3 rounded-xl border border-sand bg-sand/10 outline-none text-sm"
                    >
                      <option value="">Seleziona...</option>
                      {menuData?.categories?.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name?.it}</option>
                      ))}
                    </select>
                  </div>
               )}
            </div>
            
            <div className="flex gap-3 justify-end mt-8 border-t border-sand pt-6">
              <button type="button" onClick={() => setIsAddCatModalOpen(false)} className="px-4 py-2 text-sm text-olive hover:bg-sand rounded-xl transition-all">Annulla</button>
              <button type="submit" className="px-6 py-2 bg-sea text-white rounded-xl hover:bg-sea-light transition-all font-medium">Crea Categoria</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {menuToDelete && (
        <div className="fixed inset-0 bg-sea/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-serif text-sea mb-2">Elimina menu "{menuToDelete.name}"?</h3>
            <p className="text-sm text-olive mb-4">Questa azione eliminerà definitivamente il menu, tutte le sue categorie e tutti i suoi piatti/items. L'operazione è irreversibile.</p>
            
            {menuToDelete.isPublished && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl mb-4">
                  <p className="text-red-700 text-xs font-bold leading-tight">ATTENZIONE: questo menu è attualmente pubblicato e visibile ai clienti. Eliminandolo, scomparirà dal QR code pubblico.</p>
              </div>
            )}

            <div className="flex gap-3 justify-end mt-6">
                <button onClick={() => setMenuToDelete(null)} disabled={isDeleting} className="px-5 py-2.5 rounded-xl font-medium text-olive hover:bg-sand transition-all">Annulla</button>
                <button onClick={confirmDeleteMenu} disabled={isDeleting} className="px-5 py-2.5 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-all flex items-center gap-2">
                  {isDeleting ? <Loader2 size={16} className="animate-spin" /> : "Elimina definitivamente"}
                </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
