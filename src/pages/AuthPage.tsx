import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { COUNTRIES } from '../lib/countries';
import { Eye, EyeOff, Leaf, Sparkles } from 'lucide-react';

type AuthMode = 'login' | 'signup';

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [country, setCountry] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) { setError('Please enter your full name.'); return; }
    if (!gender) { setError('Please select your gender.'); return; }
    if (!age || parseInt(age) < 5 || parseInt(age) > 120) { setError('Please enter a valid age.'); return; }
    if (!country) { setError('Please select your country.'); return; }
    setLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        full_name: fullName,
        gender,
        age: parseInt(age),
        country,
      });
      if (profileError) {
        setError('Account created but profile save failed. Please update in settings.');
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-amber-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center pt-10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Leaf className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Athena <span className="text-emerald-600">GYAN</span></h1>
            <p className="text-xs text-gray-500 font-medium tracking-widest uppercase">Your Intelligence Companion</p>
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex items-start justify-center px-4 pt-4 pb-10">
        <div className="w-full max-w-md">
          {/* Tab switcher */}
          <div className="flex bg-gray-100 rounded-2xl p-1 mb-6">
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                mode === 'login'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(''); }}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                mode === 'signup'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="bg-white rounded-3xl shadow-xl shadow-emerald-100/50 border border-emerald-50 overflow-hidden">
            <div className="px-8 pt-8 pb-8">

              {mode === 'login' ? (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
                    <p className="text-gray-500 mt-1 text-sm">Sign in to continue your journey with Gyan</p>
                  </div>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                      <input
                        type="email"
                        required
                        value={loginEmail}
                        onChange={e => setLoginEmail(e.target.value)}
                        className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base transition-all"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={loginPassword}
                          onChange={e => setLoginPassword(e.target.value)}
                          className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base pr-12 transition-all"
                          placeholder="Your password"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    {error && <p className="text-red-500 text-sm font-medium bg-red-50 px-4 py-3 rounded-xl">{error}</p>}
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-base rounded-xl hover:from-emerald-600 hover:to-teal-700 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 shadow-lg shadow-emerald-200 mt-2"
                    >
                      {loading ? 'Signing in...' : 'Sign In to Gyan'}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Join Athena GYAN</h2>
                    <p className="text-gray-500 mt-1 text-sm">Create your account and unlock your AI companion</p>
                  </div>
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base transition-all"
                        placeholder="Your full name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base transition-all"
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base pr-12 transition-all"
                          placeholder="Min. 6 characters"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Gender</label>
                        <select
                          value={gender}
                          onChange={e => setGender(e.target.value)}
                          required
                          className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base transition-all appearance-none"
                        >
                          <option value="">Select</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="non-binary">Non-binary</option>
                          <option value="prefer-not-to-say">Prefer not to say</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Age</label>
                        <input
                          type="number"
                          required
                          min="5"
                          max="120"
                          value={age}
                          onChange={e => setAge(e.target.value)}
                          className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base transition-all"
                          placeholder="Age"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Country</label>
                      <select
                        value={country}
                        onChange={e => setCountry(e.target.value)}
                        required
                        className="w-full px-4 py-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-900 bg-gray-50 text-base transition-all appearance-none"
                      >
                        <option value="">Select your country</option>
                        {COUNTRIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    {error && <p className="text-red-500 text-sm font-medium bg-red-50 px-4 py-3 rounded-xl">{error}</p>}
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-base rounded-xl hover:from-emerald-600 hover:to-teal-700 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 shadow-lg shadow-emerald-200 mt-2"
                    >
                      {loading ? 'Creating account...' : 'Create My Account'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <p className="text-xs text-gray-400 text-center">Your data is safe and private. Powered by Supabase security.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
