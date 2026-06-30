// ════════════════════════════════════════════════════════════
// apps/web/src/pages/auth/LoginPage.tsx
// ════════════════════════════════════════════════════════════
import { useState }        from 'react'
import { Pill, Eye, EyeOff } from 'lucide-react'
import { useLogin }          from '../../api/auth.api'
import { Button }            from '../../components/ui/Button'
import { Input }             from '../../components/ui/Input'

const DEMO_ACCOUNTS = [
  { label:'Super Admin',  role:'SUPER_ADMIN', email:'admin@pharmacare.co.ke',        pw:'Admin@1234!',  color:'from-red-500 to-red-700' },
  { label:'Pharmacist',   role:'PHARMACIST',  email:'pharmacist@pharmacare.co.ke',   pw:'Pharma@1234!', color:'from-blue to-indigo-600' },
  { label:'Cashier',      role:'CASHIER',     email:'cashier@pharmacare.co.ke',      pw:'Cash@1234!',   color:'from-green to-emerald-600' },
]

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const login = useLogin()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    login.mutate({ email, password })
  }

  function quickLogin(e: string, p: string) {
    setEmail(e); setPassword(p)
    login.mutate({ email: e, password: p })
  }

  return (
    <div className="w-full max-w-md relative z-10">
      {/* Card */}
      <div className="glass-card px-8 py-10 relative overflow-hidden">
        {/* Top accent */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r
                        from-transparent via-blue to-purple" />

        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue to-indigo-600
                          flex items-center justify-center
                          shadow-[0_8px_24px_rgba(59,130,246,.4)]">
            <Pill size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-text tracking-tight">PharmPro</h1>
            <p className="text-xs text-text3 tracking-widest uppercase">Enterprise v1.0</p>
          </div>
        </div>

        <p className="text-center text-xs text-text3 uppercase tracking-widest mb-7">
          Sign in to your pharmacy
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@pharmacare.co.ke"
            autoComplete="email"
            required
          />
          <div className="relative">
            <Input
              label="Password"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              rightIcon={
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="text-text3 hover:text-text2 transition-colors">
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              }
            />
          </div>

          {login.isError && (
            <p className="text-xs text-red text-center py-2 bg-red-lt rounded-lg">
              {(login.error as any)?.response?.data?.message ?? 'Invalid credentials'}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={login.isPending}
            className="w-full mt-2"
          >
            Sign In
          </Button>
        </form>

        {/* Demo accounts */}
        <div className="mt-8 pt-6 border-t border-border">
          <p className="text-xs text-text3 text-center mb-3">Demo accounts</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map(a => (
              <button
                key={a.role}
                onClick={() => quickLogin(a.email, a.pw)}
                disabled={login.isPending}
                className="group p-2.5 rounded-lg bg-surface border border-border
                           hover:border-border text-center transition-all
                           hover:bg-bg4 disabled:opacity-50"
              >
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${a.color}
                                flex items-center justify-center mx-auto mb-1.5`}>
                  <span className="text-white text-xs font-bold">
                    {a.label[0]}
                  </span>
                </div>
                <p className="text-xs font-bold text-blue">{a.label}</p>
                <p className="text-xs text-text3 mt-0.5 truncate">{a.pw}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}


