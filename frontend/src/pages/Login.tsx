// src/pages/Login.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Eye, EyeOff, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { authService } from '@/services/api'
import { useAuthStore } from '@/stores'

interface FormData {
  username: string
  password: string
  totp_code?: string
}

export function Login() {
  const navigate = useNavigate()
  const { setUsuario } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [requires2FA, setRequires2FA] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>()

  const onSubmit = async (data: FormData) => {
    setIsLoading(true)
    try {
      const res = await authService.login(data)
      setUsuario(res.usuario, res.access_token, res.refresh_token)
      toast.success(`Bienvenido, ${res.usuario.nombre_completo || res.usuario.username}`)
      navigate('/')
    } catch (err: any) {
      const status = err.response?.status
      const detail = err.response?.data?.detail || ''

      if (status === 401 && err.response?.headers?.['x-2fa-required']) {
        setRequires2FA(true)
        toast('Introduce el código de tu autenticador', { icon: '🔐' })
      } else if (detail) {
        toast.error(detail)
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg-tertiary)' }}
    >
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold mx-auto mb-4"
            style={{ background: 'var(--brand)' }}
          >
            SI
          </div>
          <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            SIGINT DataCenter Pro
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Accede con tus credenciales
          </p>
        </div>

        {/* Form */}
        <div className="card p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Usuario o email
              </label>
              <input
                className="input"
                placeholder="usuario o email@dominio.com"
                autoComplete="username"
                {...register('username', { required: 'Campo obligatorio' })}
              />
              {errors.username && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-red)' }}>
                  {errors.username.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Contraseña
              </label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  {...register('password', { required: 'Campo obligatorio' })}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword
                    ? <EyeOff size={14} style={{ color: 'var(--text-tertiary)' }} />
                    : <Eye size={14} style={{ color: 'var(--text-tertiary)' }} />
                  }
                </button>
              </div>
              {errors.password && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-red)' }}>
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* 2FA field — aparece solo si se requiere */}
            {requires2FA && (
              <div className="animate-in">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <Shield size={12} className="inline mr-1" />
                  Código 2FA (Google Authenticator / Authy)
                </label>
                <input
                  className="input text-center tracking-widest text-base font-mono"
                  placeholder="000 000"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  {...register('totp_code')}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center py-2"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Accediendo...
                </span>
              ) : (
                requires2FA ? 'Verificar y acceder' : 'Acceder'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-tertiary)' }}>
          SIGINT DataCenter Pro · Uso restringido · Clasificado
        </p>
      </div>
    </div>
  )
}
