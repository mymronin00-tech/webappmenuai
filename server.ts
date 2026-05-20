import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let aiClient: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// API: Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Poly-schema components for menu parsing
const sharedItemProperties = {
  nome: { type: Type.OBJECT, properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } } },
  descrizione: { type: Type.OBJECT, properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } } },
  prezzo: { type: Type.NUMBER },
};

// API: Parse menu from image
app.post("/api/menu/parse", async (req, res) => {
  req.setTimeout(180000); // 3 minutes timeout
  try {
    const { image, fileData, mimeType, menuType } = req.body; 
    
    const dataString = fileData || image;
    const actualMimeType = mimeType || "image/jpeg";

    if (!dataString) throw new Error("File data is missing");

    const response = await generateContentWithRetry((modelName) => ({
      model: modelName, 
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: actualMimeType,
              data: dataString.split(',')[1] || dataString
            }
          },
          {
            text: `Extract the menu structure from this document. The menu type is "${menuType}".
            Return a JSON object with:
            - categories: array of objects { name: { it, en, fr, de } }
            - dishesByCategoryId: array of objects { categoryId: "ITALIAN_CATEGORY_NAME", dishes: [] }
            - domande_di_chiarimento: array of strings containing questions for missing/ambiguous fields.
            
            Based on the menuType, dishes array should contain:
            - type "ristorante" | "pizzeria": { tipo: "piatto", nome, descrizione, prezzo, ingredienti: [], allergeni: [], tecnica_cottura: "", tag_dietetici: [] }
            - type "carta_vini": { tipo: "vino", nome, cantina, denominazione, annata, zona, vitigni: [], gradazione, tipologia, note_degustative, storia, abbinamenti_consigliati: [], prezzo_calice }
            - type "cocktail": { tipo: "cocktail", nome, categoria_drink, base_alcolica, ingredienti: [], garnish, metodo, glassware, gradazione_indicativa, note_assaggio, allergeni: [] }
            - type "bar": { tipo: "bar_semplice", nome, descrizione, prezzo, varianti: [] }

            Leave fields empty or null if not present in the image. Do NOT invent data. Accurate translations.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.OBJECT,
                    properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } },
                    required: ["it"]
                  }
                },
                required: ["name"]
              }
            },
            dishesByCategoryId: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  categoryId: { type: Type.STRING },
                  dishes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        tipo: { type: Type.STRING },
                        nome: { type: Type.OBJECT, properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } } },
                        descrizione: { type: Type.OBJECT, properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } } },
                        prezzo: { type: Type.NUMBER },
                        ingredienti: { type: Type.ARRAY, items: { type: Type.STRING } },
                        allergeni: { type: Type.ARRAY, items: { type: Type.STRING } },
                        tecnica_cottura: { type: Type.STRING },
                        tag_dietetici: { type: Type.ARRAY, items: { type: Type.STRING } },
                        cantina: { type: Type.STRING },
                        denominazione: { type: Type.STRING },
                        annata: { type: Type.NUMBER },
                        zona: { type: Type.STRING },
                        vitigni: { type: Type.ARRAY, items: { type: Type.STRING } },
                        gradazione: { type: Type.NUMBER },
                        tipologia: { type: Type.STRING },
                        note_degustative: { type: Type.STRING },
                        storia: { type: Type.STRING },
                        abbinamenti_consigliati: { type: Type.ARRAY, items: { type: Type.STRING } },
                        prezzo_calice: { type: Type.NUMBER },
                        categoria_drink: { type: Type.STRING },
                        base_alcolica: { type: Type.STRING },
                        garnish: { type: Type.STRING },
                        metodo: { type: Type.STRING },
                        glassware: { type: Type.STRING },
                        gradazione_indicativa: { type: Type.STRING },
                        note_assaggio: { type: Type.STRING },
                        varianti: { type: Type.ARRAY, items: { type: Type.STRING } },
                      }
                    }
                  }
                },
                required: ["categoryId", "dishes"]
              }
            },
            domande_di_chiarimento: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["categories", "dishesByCategoryId"]
        }
      }
    }));

    if (!response.text) {
      throw new Error("Empty response from AI");
    }

    res.json(JSON.parse(response.text));
  } catch (error: any) {
    console.error("Parse Error:", error);
    res.status(500).json({ error: error.message });
  }
});

function computeAllergeni(
  ingredienti: any, 
  context?: { nome?: string; categoria?: string; menuType?: string; descrizione?: string }
): string[] {
  const allergensSet = new Set<string>();
  
  let extractedIngs: string[] = [];
  if (Array.isArray(ingredienti)) {
    extractedIngs = ingredienti;
  } else if (ingredienti && typeof ingredienti === 'object' && Array.isArray(ingredienti.it)) {
    extractedIngs = ingredienti.it;
  }
  
  const rawIngs: any[] = [...extractedIngs];
  if (context?.nome) {
    rawIngs.push(context.nome);
  }
  if (context?.descrizione) {
    rawIngs.push(context.descrizione);
  }
  const ingsLower = rawIngs
    .map(i => {
      if (typeof i === "string") return i.toLowerCase();
      if (i && typeof i === "object") {
        // gestisce campi multilingua tipo {it: "...", en: "..."}
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
  
  const nomeLower = (context?.nome || "").toLowerCase();
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

async function translatePiatti(parsedResult: any, sourceLang = "it") {
  // Costruisci elenco testi da tradurre
  const textsToTranslate: string[] = [];
  parsedResult.dishesByCategoryId?.forEach((cat: any) => {
    cat.dishes?.forEach((d: any) => {
      if (d.nome && typeof d.nome === "string") d.nome = { it: d.nome };
      if (d.descrizione && typeof d.descrizione === "string") d.descrizione = { it: d.descrizione };
      if (d.ingredienti && Array.isArray(d.ingredienti) && d.ingredienti.length > 0 && typeof d.ingredienti[0] === "string") {
        d.ingredienti = { it: d.ingredienti };
      }

      if (d.nome?.[sourceLang]) textsToTranslate.push(d.nome[sourceLang]);
      if (d.descrizione?.[sourceLang]) textsToTranslate.push(d.descrizione[sourceLang]);
      if (d.ingredienti?.[sourceLang]) d.ingredienti[sourceLang].forEach((ing: string) => textsToTranslate.push(ing));
    });
  });
  
  parsedResult.categories?.forEach((c: any) => {
    if (c.name && typeof c.name === "string") c.name = { it: c.name };
    if (c.name?.[sourceLang]) textsToTranslate.push(c.name[sourceLang]);
  });
  
  if (textsToTranslate.length === 0) return parsedResult;
  
  const prompt = `Sei un traduttore esperto di menu di ristoranti italiani. Devi tradurre nomi di piatti dall'italiano in inglese (en), francese (fr) e tedesco (de). Segui queste regole RIGOROSE:

REGOLA 1 — MAI TRADURRE i seguenti termini (lasciali identici all'originale):
- Tipi di pasta: spaghetti, linguine, tagliolini, tagliatelle, orecchiette, troccoli, troccolo, calamarata, rigatoni, fettuccine, ravioli, lasagne, gnocchi, penne, farfalle, paccheri, fusilli, bucatini, tortellini, agnolotti, malloreddus, sagne, pici, bigoli
- Nomi di pizza: Margherita, Marinara, Capricciosa, Bologna-Leuca
- Formaggi italiani: burrata, mozzarella, fior di latte, scamorza, ricotta, stracciatella, provola, pecorino, parmigiano, gorgonzola, mascarpone, taleggio, asiago
- Preparazioni storiche: antipasto, frittata, carpaccio, crudité, frutti di mare, fritto misto
- Vitigni italiani: Sangiovese, Nebbiolo, Primitivo, Negroamaro

REGOLA 2 — TRADUCI questi tipi di parole:
- Ingredienti pesci/carni: polpo, vongole, cozze, tonno, gamberi
- Verdure, Carne, Aggettivi/tecniche

REGOLA 3 — STRUTTURA del piatto da preservare in ogni lingua.
REGOLA 4 — Nomi propri inventati o regionalismi sconosciuti: LASCIALI INVARIATI.

OUTPUT: ritorna SOLO un oggetto JSON strutturato esattamente come:
{
  "en": ["traduzione1", "traduzione2", ...],
  "fr": ["traduzione1", "traduzione2", ...],
  "de": ["traduzione1", "traduzione2", ...]
}
Gli array "en", "fr" e "de" devono contenere ESATTAMENTE ${textsToTranslate.length} elementi ciascuno, corrispondenti all'ordine dei testi passati.
Niente commenti, niente spiegazioni.

TESTI DA TRADURRE: ${JSON.stringify(textsToTranslate)}`;

  let translations = { en: [] as string[], fr: [] as string[], de: [] as string[] };
  try {
    const result = await callGeminiWithRetry(
      (modelName) => getAI().chats.create({ 
        model: modelName,
        config: { responseMimeType: "application/json" }
      }),
      prompt
    );
    let text = result.text || "{}";
    if (text.includes("\`\`\`json")) {
      text = text.split("\`\`\`json")[1].split("\`\`\`")[0].trim();
    } else if (text.includes("\`\`\`")) {
      text = text.split("\`\`\`")[1].split("\`\`\`")[0].trim();
    }
    const translated = JSON.parse(text);
    if (translated.en && translated.fr && translated.de) {
      translations = translated;
    }
  } catch (e: any) {
    console.error("Errore traduzione batch:", e?.message || e);
  }

  // Mappa back ai piatti
  let idx = 0;
  parsedResult.dishesByCategoryId?.forEach((cat: any) => {
    cat.dishes?.forEach((d: any) => {
      if (d.nome?.[sourceLang]) {
        d.nome.en = translations.en[idx] || d.nome[sourceLang];
        d.nome.fr = translations.fr[idx] || d.nome[sourceLang];
        d.nome.de = translations.de[idx] || d.nome[sourceLang];
        idx++;
      }
      if (d.descrizione?.[sourceLang]) {
        d.descrizione.en = translations.en[idx] || d.descrizione[sourceLang];
        d.descrizione.fr = translations.fr[idx] || d.descrizione[sourceLang];
        d.descrizione.de = translations.de[idx] || d.descrizione[sourceLang];
        idx++;
      }
      if (d.ingredienti?.[sourceLang]) {
        d.ingredienti.en = [];
        d.ingredienti.fr = [];
        d.ingredienti.de = [];
        d.ingredienti[sourceLang].forEach((ing: string) => {
           d.ingredienti.en.push(translations.en[idx] || ing);
           d.ingredienti.fr.push(translations.fr[idx] || ing);
           d.ingredienti.de.push(translations.de[idx] || ing);
           idx++;
        });
      }
    });
  });
  parsedResult.categories?.forEach((c: any) => {
    if (c.name?.[sourceLang]) {
      c.name.en = translations.en[idx] || c.name[sourceLang];
      c.name.fr = translations.fr[idx] || c.name[sourceLang];
      c.name.de = translations.de[idx] || c.name[sourceLang];
      idx++;
    }
  });
  
  return parsedResult;
}

// API: Parse menu from image with auto-translation
app.post("/api/menu/parse-v2", async (req, res) => {
  req.setTimeout(300000); // 5 minutes timeout for parse + translate
  
  // Implemet dummy stream to keep connection alive and bypass proxy timeout
  res.setHeader("Content-Type", "application/json");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  
  const keepAliveInterval = setInterval(() => {
    res.write(" "); // Send space to bypass 60s proxy idle timeout
  }, 10000);

  try {
    const { image, fileData, mimeType, menuType } = req.body; 
    const dataString = fileData || image;
    const actualMimeType = mimeType || "image/jpeg";

    const response = await generateContentWithRetry((modelName) => ({
      model: modelName, 
      contents: {
        parts: [
          { inlineData: { mimeType: actualMimeType, data: dataString.split(',')[1] || dataString } },
          { text: `Extract dishes and categories from this menu image. 
Return JSON strictly following the schema. 
- The 'categories' array must contain the names of the menu sections.
- The 'dishesByCategoryId' array must group dishes under their respective sections.
- IMPORTANT: Extract all ingredients from the description and format them as an array of strings in the 'ingredienti' field.
- IMPORTANT: The 'categoryId' in 'dishesByCategoryId' MUST EXACTLY MATCH the 'categories[].name.it' string (same spelling and case).

ESTRAZIONE INGREDIENTI (OBBLIGATORIA, NON OPZIONALE):
Per OGNI piatto devi popolare il campo "ingredienti" come array di stringhe. NON lasciarlo vuoto se è possibile derivarlo. Casi tipici:

1. MENU PIZZA: il nome è grande (es. "MARGHERITA"), e SUBITO SOTTO c'è una riga con font più piccolo che elenca gli ingredienti separati da virgole (es. "POMODORO SAN MARZANO, FIOR DI LATTE, BASILICO"). DEVI estrarre questa riga sotto e metterla come array nell campo ingredienti.
   Esempio: "MARGHERITA / POMODORO SAN MARZANO, FIOR DI LATTE, BASILICO" → nome: "MARGHERITA", ingredienti: ["pomodoro san marzano", "fior di latte", "basilico"]
   Esempio: "AMERICANINO / POMODORO SAN MARZANO, FIOR DI LATTE, WÜRSTEL, PATATINE FRITTE" → ingredienti: ["pomodoro san marzano", "fior di latte", "würstel", "patatine fritte"]
   Esempio: "BOLOGNA-LEUCA / BASE BIANCA, POMODORINO GIALLO, PROVOLA FRESCA. IN USCITA: MORTADELLA, GRANELLA DI PISTACCHI" → ingredienti: ["base bianca", "pomodorino giallo", "provola fresca", "mortadella", "granella di pistacchi"]
   La parte "IN USCITA:" indica ingredienti aggiunti dopo cottura. Includili tutti nell'array.

2. MENU RISTORANTE: gli ingredienti sono nel NOME STESSO del piatto. Esempi: "SPAGHETTI ALLE COZZE" → ingredienti: ["spaghetti", "cozze"]. "POLIPO, PATATE E SEDANO FINE" → ingredienti: ["polipo", "patate", "sedano"]. "BURRATINA E ACCIUGHE DEL CANTABRICO" → ingredienti: ["burratina", "acciughe del cantabrico"]. Se il nome contiene una parentesi con ingredienti (es. "CRUDITÉ (SCAMPI, GAMBERI, TONNO E RICCIOLA)"), estrai gli ingredienti DALLA PARENTESI.

REGOLA CRITICA: lasciare ingredienti vuoto o assente quando la foto ne contiene chiaramente è un errore grave. Controlla sempre se c'è una riga sotto il nome o ingredienti nel nome stesso o nella parentesi prima di restituire un array vuoto.

CLASSIFICAZIONE DIETETICA (regola CONSERVATIVA STRETTA - in dubbio = false):
Compila i 4 booleani vegetariano, vegano, senza_glutine, senza_lattosio per OGNI piatto.

vegetariano = true SOLO se NESSUN ingrediente è: carne, pesce, crostacei, molluschi, salume, brodo di carne/pesce, gelatina animale, lardo, strutto, würstel, mortadella, prosciutto, speck, salame, tonno, polipo, scampi, cozze, vongole, gamberi, ricciola, branzino, orata, calamari, seppia, acciughe.
- Se ingredienti vuoto E nome contiene parole sospette (es. "Crudité", "Tartare", "Fritto di mare", "Frutti di mare") = false.

vegano = true SOLO se vegetariano=true E NESSUN ingrediente è: latte, mozzarella, fior di latte, burrata, ricotta, scamorza, provola, pecorino, parmigiano, gorgonzola, formaggio, burro, panna, uovo, uova, miele.

senza_glutine = true SOLO se NESSUN ingrediente è: pasta (spaghetti, linguine, troccoli, tagliolino, orecchiette, ravioli, lasagne, gnocchi, penne), pane, pizza, mollica, farina, pangrattato, crosta di sesamo o pavoero (la crosta solitamente contiene farina), würstel, ventricina, mortadella (possono contenere glutine in tracce), pasta sfoglia, tiramisù, spumone, base pizza, calzone, frittura (impanatura).
- Se piatto è una pizza o un calzone = false sempre.
- Se piatto è un dolce non specificato chiaramente come senza glutine = false.

senza_lattosio = true SOLO se NESSUN ingrediente è: latte, mozzarella, fior di latte, burrata, burratina, ricotta, scamorza, provola, pecorino, parmigiano, grana, gorgonzola, formaggio, feta, emmental, burro, panna, mascarpone, yogurt, gelato, spumone, tiramisù, crema di latte.

REGOLA DI SICUREZZA: se hai QUALSIASI dubbio sulla composizione, metti false. È meglio un false negativo (piatto vegano marcato come non-vegano) di un falso positivo (piatto non-vegano marcato come vegano) che può causare reazioni allergiche o tradimento di restrizioni etiche.` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.OBJECT,
                    properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } },
                    required: ["it"]
                  }
                }
              }
            },
            dishesByCategoryId: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  categoryId: { type: Type.STRING },
                  dishes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        nome: { type: Type.OBJECT, properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } } },
                        descrizione: { type: Type.OBJECT, properties: { it: { type: Type.STRING }, en: { type: Type.STRING }, fr: { type: Type.STRING }, de: { type: Type.STRING } } },
                        prezzo: { type: Type.NUMBER },
                        ingredienti: { type: Type.ARRAY, items: { type: Type.STRING } },
                        vegetariano: { type: Type.BOOLEAN },
                        vegano: { type: Type.BOOLEAN },
                        senza_glutine: { type: Type.BOOLEAN },
                        senza_lattosio: { type: Type.BOOLEAN },
                        allergeni: { type: Type.ARRAY, items: { type: Type.STRING } },
                      }
                    }
                  }
                }
              }
            },
            domande_di_chiarimento: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    }));

    const extracted = JSON.parse(response.text || "{}");
    
    extracted.dishesByCategoryId?.forEach((cat: any) => {
      cat.dishes?.forEach((d: any) => {
        d.allergeni = computeAllergeni(d.ingredienti || [], {
          nome: d.nome?.it || d.nome || "",
          categoria: cat.categoryId || "",
          menuType: menuType || "",
          descrizione: d.descrizione?.it || d.descrizione || ""
        });
      });
    });

    const translated = await translatePiatti(extracted, "it");
    clearInterval(keepAliveInterval);
    res.end(JSON.stringify(translated));
  } catch (error: any) {
    clearInterval(keepAliveInterval);
    console.error("Parse V2 Error:", error);
    res.end(JSON.stringify({ error: error.message }));
  }
});

// API: Batch translate menu
app.post("/api/menu/translate", async (req, res) => {
  req.setTimeout(300000); // 5 mins timeout
  
  res.setHeader("Content-Type", "application/json");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  
  const keepAliveInterval = setInterval(() => {
    res.write(" "); 
  }, 10000);

  try {
    const { categories, dishesByCategoryId } = req.body;
    
    if (categories && dishesByCategoryId) {
      const translated = await translatePiatti({ categories, dishesByCategoryId }, "it");
      clearInterval(keepAliveInterval);
      res.end(JSON.stringify(translated));
      return;
    }
    
    clearInterval(keepAliveInterval);
    res.end(JSON.stringify({ error: "Missing required parameters categories and dishesByCategoryId" }));
  } catch (error: any) {
    clearInterval(keepAliveInterval);
    console.error("Translation api error:", error);
    res.end(JSON.stringify({ error: error.message }));
  }
});

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-3.5-flash'];

async function generateContentWithRetry(reqFactory: (model: string) => any) {
  const maxModelAttempts = 2;
  const totalAttempts = FALLBACK_MODELS.length * maxModelAttempts;
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const modelIndex = Math.floor(attempt / maxModelAttempts);
    const modelAttempt = attempt % maxModelAttempts;
    const model = FALLBACK_MODELS[modelIndex];
    try {
      return await getAI().models.generateContent(reqFactory(model));
    } catch (error: any) {
      const status = error.status || error.code || (error.error && (error.error.status || error.error.code)) || error.response?.status;
      const isRateLimitOrUnavailableOrNotFound = 
        status === 503 || status === 429 || status === 404 ||
        status === "UNAVAILABLE" || status === "NOT_FOUND" ||
        error.message?.includes("UNAVAILABLE") || error.message?.includes("429") || error.message?.includes("503") ||
        error.message?.includes("NOT_FOUND") || error.message?.includes("404") || error.message?.includes("no longer available");
      
      if (isRateLimitOrUnavailableOrNotFound) {
        if (attempt < totalAttempts - 1) {
          const nextModelIndex = Math.floor((attempt + 1) / maxModelAttempts);
          const willRetrySameModel = nextModelIndex === modelIndex;
          const nextModel = willRetrySameModel ? `${model} (retry)` : (FALLBACK_MODELS[nextModelIndex] || "end of chain");
          const waitMs = modelAttempt === 0 ? 2000 : 4000;
          console.warn(`Gemini API error ${status} on ${model} (attempt ${modelAttempt + 1}/${maxModelAttempts}), retry in ${waitMs}ms with ${nextModel} (overall attempt ${attempt + 1}/${totalAttempts})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
}

async function callGeminiWithRetry(chatFactory: (model: string) => any, msgToSend: any) {
  const maxModelAttempts = 2;
  const totalAttempts = FALLBACK_MODELS.length * maxModelAttempts;
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const modelIndex = Math.floor(attempt / maxModelAttempts);
    const modelAttempt = attempt % maxModelAttempts;
    const model = FALLBACK_MODELS[modelIndex];
    try {
      const chat = chatFactory(model);
      return await chat.sendMessage({ message: msgToSend });
    } catch (error: any) {
      const status = error.status || error.code || (error.error && (error.error.status || error.error.code)) || error.response?.status;
      const isRateLimitOrUnavailableOrNotFound = 
        status === 503 || status === 429 || status === 404 ||
        status === "UNAVAILABLE" || status === "NOT_FOUND" ||
        error.message?.includes("UNAVAILABLE") || error.message?.includes("429") || error.message?.includes("503") ||
        error.message?.includes("NOT_FOUND") || error.message?.includes("404") || error.message?.includes("no longer available");
      
      if (isRateLimitOrUnavailableOrNotFound) {
        if (attempt < totalAttempts - 1) {
          const nextModelIndex = Math.floor((attempt + 1) / maxModelAttempts);
          const willRetrySameModel = nextModelIndex === modelIndex;
          const nextModel = willRetrySameModel ? `${model} (retry)` : (FALLBACK_MODELS[nextModelIndex] || "end of chain");
          const waitMs = modelAttempt === 0 ? 2000 : 4000;
          console.warn(`Gemini error ${status} on ${model} (attempt ${modelAttempt + 1}/${maxModelAttempts}), retry in ${waitMs}ms with ${nextModel} (overall attempt ${attempt + 1}/${totalAttempts})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
}

// API: Owner Chat
app.post("/api/owner/chat", async (req, res) => {
  req.setTimeout(300000); // 5 mins timeout
  res.setHeader("Content-Type", "application/json");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const keepAliveInterval = setInterval(() => { res.write(" "); }, 10000);

  try {
    const { message, restaurantId, activeMenuContext, menus, history, activePlans, trigger, parse_result, fileData, mimeType } = req.body;
    
    let instructions = `Sei l'assistente AI di MenuLive. Aiuti il proprietario di un ristorante a gestire il suo menu digitale in italiano. Tono educato medio, frasi brevi e concrete.
        
    Contesto attuale:
    Tutti i Menu del Ristorante: ${JSON.stringify(menus)}
    Menu Attivo al momento: ${JSON.stringify(activeMenuContext)}
    Pianificazioni aperte: ${JSON.stringify(activePlans)}
    
    REGOLE FONDAMENTALI PER LE AZIONI:
    1. Quando proponi un'azione che modifica il menu, includi alla fine del tuo messaggio un blocco JSON nel formato:
    \`\`\`json
    {
      "azione_proposta": {
        "type": "direct_update" | "schedule_update" | "direct_create" | "schedule_create" | "direct_delete",
        "trigger_datetime": "ISO_STRING if scheduled",
        "target": { "menuId": "id", "categoriaId": "id", "itemId": "id_or_new" },
        "updates": { "campo": "nuovo valore" },
        "descrizione": "Stringa human-readable chiara dell'azione, per la UI (es. 'Eliminerò definitivamente il menu delle pizze')"
      }
    }
    \`\`\`
    2. Il tuo testo conversazionale deve essere autosufficiente, SENZA fare riferimento al JSON sottostante o dire "come vedi nel JSON". Scrivi naturalmente.
    3. Se chiedi conferma, NON anticipare che hai "eliminato", "aggiornato" o "pianificato". Dì solo cosa STAI PER fare. L'esito verrà confermato dopo il click di conferma del ristoratore. (es: "Eliminerò il menu delle pizze. Confermi?")
    4. Riconosci comandi temporali (oggi, domani, per il weekend) e proponili come schedulazioni ("schedule_*"), non come dirette ("direct_*").
    5. Massimo UN blocco JSON per messaggio. Deve essere racchiuso in fence \`\`\`json.
    6. Se chiedi chiarimenti, falli uno alla volta. Non fare questionari.
    7. Quando aggiungi o modifichi un piatto, INCLUDI l'estrazione degli "ingredienti" (array di stringhe) se menzionati, separandoli dalla descrizione.`;

    if (trigger === "post_parsing" && parse_result) {
      instructions += `\n\nL'utente ha appena caricato un menu. Stato dettagliato del parsing: ${JSON.stringify(parse_result)}. Genera un messaggio di onboarding proattivo seguendo QUESTE regole:

      1. PRIMA RIGA: breve saluto + riepilogo numerico (es. 'Ho estratto 23 piatti dal tuo Menu Ristorante')
      2. SECONDA SEZIONE: cita 2-3 piatti specifici PER NOME con eventuali problemi reali dal parse_result. Esempio: 'Sul Pescato del giorno ho letto 120/kg, confermi che è il prezzo al chilo?' oppure 'Sul Tagliolino burro di Normandia ho estratto 5 ingredienti ma manca la tecnica di cottura, vuoi specificarla?'
      3. TERZA SEZIONE: chiudi con UNA domanda concreta e azionabile per il ristoratore. Non un questionario.

      REGOLE:
      - Usa i NOMI VERI dei piatti citati nel parse_result, non frasi generiche.
      - Massimo 4-5 righe totali.
      - Italiano educato, tono professionale ma caldo.
      - Se non ci sono problemi rilevanti, di' 'Tutto sembra estratto correttamente, vuoi pubblicare il menu o ti aiuto a completare i dettagli mancanti?'
      - NON includere blocchi JSON di azione_proposta in questo messaggio iniziale (è solo informativo + UNA domanda).`;
    }

    if (trigger === "action_cancelled") {
      instructions += `\n\nL'utente ha ANNULLATO l'azione proposta: "${req.body.action_desc}". 
      Prendi atto dell'annullamento con una frase brevissima (max 10-15 parole) ed educata. 
      Esempio: 'Nessun problema, ho annullato la modifica. Serve altro?' o 'Capito, l'azione è stata cancellata. Come posso aiutarti ora?'
      NON proporre altre azioni in questo messaggio.`;
    }

    const formattedHistory = (history || []).map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));
    
    let msgToSend: any = message || (trigger === "post_parsing" ? "Genera riepilogo parsing" : "Ciao");
    
    if (fileData && mimeType) {
        msgToSend = [
            { text: message || "Analizza questo file per aggiornare o rispondere alle mie richieste:" },
            { inlineData: { mimeType, data: fileData.includes(',') ? fileData.split(',')[1] : fileData } }
        ];
    }

    const result = await callGeminiWithRetry(
      (modelName) => getAI().chats.create({
        model: modelName,
        history: formattedHistory,
        config: {
          systemInstruction: instructions
        }
      }), 
      msgToSend
    );
    clearInterval(keepAliveInterval);
    res.end(JSON.stringify({ text: result.text }));
  } catch (error: any) {
    clearInterval(keepAliveInterval);
    console.error("Owner Chat Error:", error);
    res.end(JSON.stringify({ error: error.message }));
  }
});

// API: Execute Action (Owner)
app.post("/api/owner/execute-action", async (req, res) => {
  try {
    const { action, restaurantId } = req.body;
    // In a full architecture with Firebase Admin SDK, we would update documents here.
    // For this client-driven setup, we just confirm receipt.
    console.log("Executing action server-side for", restaurantId, action);
    res.json({ success: true, message: "Azione confermata" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API: Simulated CRON (applyScheduledChanges)
app.post("/api/cron/apply-scheduled", async (req, res) => {
  // A Cloud Scheduler would hit this endpoint every 5 minutes.
  console.log("CRON: applyScheduledChanges running...");
  res.json({ success: true, message: "CRON Triggered" });
});

// API: Customer Chat
app.post("/api/customer/chat", async (req, res) => {
  req.setTimeout(300000); // 5 mins timeout
  res.setHeader("Content-Type", "application/json");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const keepAliveInterval = setInterval(() => { res.write(" "); }, 10000);

  try {
    const { message, menuContext, history } = req.body;
    
    // Map history to SDK format
    const formattedHistory = (history || []).map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));
    
    // Using Gemini Flash for cost-effective chat
    const msgToSend = message;
    const result = await callGeminiWithRetry(
      (modelName) => getAI().chats.create({
        model: modelName,
        history: formattedHistory,
        config: {
          temperature: 0.2,
          systemInstruction: `Sei l'assistente menu del ristorante. Hai accesso SOLO ai dati nel JSON menuContext: ${JSON.stringify(menuContext)}

REGOLA FERREA — RISTREZIONI ALIMENTARI E ALLERGIE:
Quando l'utente menziona dieta vegetariana, vegana, celiachia, intolleranza al lattosio, o qualsiasi allergia, NON DEDURRE MAI dai nomi dei piatti o ingredienti.
- Per "vegetariano": elenca SOLO piatti con vegetariano===true
- Per "vegano": elenca SOLO piatti con vegano===true
- Per "celiaco / senza glutine": elenca SOLO piatti con senza_glutine===true
- Per "intollerante al lattosio": elenca SOLO piatti con senza_lattosio===true
- Per allergie specifiche (es. "allergico ai crostacei"): elenca SOLO piatti il cui array allergeni NON contiene quell'allergene
- Se NESSUN piatto matcha, dichiaralo onestamente: "Mi dispiace, in questo menu non sono presenti piatti adatti alla sua richiesta. Le consiglio di rivolgersi al personale per opzioni custom."
- MAI inventare un piatto. MAI raccomandare un piatto non flaggato come adatto.

Per consigli generici sui piatti: usa i dati nel JSON (nome, descrizione, ingredienti, tecnica). Se un campo è vuoto, dichiara che il ristorante non l'ha specificato.

Per chat sui vini (sommelier): conosci SOLO i dati enologici nel vino (cantina, annata, vitigni, zona, note_degustative, storia, abbinamenti_consigliati). NON aggiungere conoscenza dal training. Se l'utente chiede dettagli non nei dati, dichiara che il ristorante non li ha specificati.

Per chat sui cocktail (bartender): se cocktail è classico universalmente noto (Negroni, Margarita, Mojito, Spritz, Americano) E gli ingredienti dichiarati corrispondono alla ricetta standard, puoi citare storia generale. Se signature o sconosciuto, limitati ai dati nel JSON.

Risposte brevi, educate, in lingua dell'utente (IT/EN/FR/DE). Mai inventare informazioni mancanti.`
        }
      }),
      msgToSend
    );
    clearInterval(keepAliveInterval);
    res.end(JSON.stringify({ text: result.text }));
  } catch (error: any) {
    clearInterval(keepAliveInterval);
    console.error("Chat Error:", error);
    res.end(JSON.stringify({ error: error.message }));
  }
});

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function startServer() {
  try {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
