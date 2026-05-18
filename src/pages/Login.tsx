import { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "../lib/firebase";
import { LogIn, UserPlus } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-sand">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-serif text-sea mb-2">MenuLive</h1>
          <p className="text-olive">Digitalizza il tuo menu con l'AI</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input 
              type="email" 
              className="w-full p-3 rounded-xl border border-sand bg-sand/20 focus:ring-2 focus:ring-sea outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input 
              type="password" 
              className="w-full p-3 rounded-xl border border-sand bg-sand/20 focus:ring-2 focus:ring-sea outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Caricamento..." : (
              <>
                {isRegistering ? <UserPlus size={20} /> : <LogIn size={20} />}
                {isRegistering ? "Registrati" : "Accedi"}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3">
          <button 
            onClick={signInWithGoogle}
            disabled={loading}
            className="w-full p-3 border border-sand rounded-xl flex items-center justify-center gap-2 hover:bg-sand/20 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
            Continua con Google
          </button>

          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-sm text-center text-olive hover:text-sea underline"
          >
            {isRegistering ? "Hai già un account? Accedi" : "Non hai un account? Registrati"}
          </button>
        </div>
      </div>
    </div>
  );
}
