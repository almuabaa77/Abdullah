import type { PoolOptions } from 'mysql2/promise'

type DatabaseConfig = { options: PoolOptions } | { issue: 'missing_config' | 'invalid_config' | 'password_is_example' }

function isExamplePassword(password: string) {
  const value = password.trim()
  return value === 'كلمة_مرور_قاعدة_البيانات' || value === 'كلمة_المرور'
    || /^(?:DATABASE_URL\s*=\s*)?mysql2?:\/\/[^:\s/]+:[^\r\n]*@[^/\s]+\/\S+$/i.test(value)
}

export function mysqlConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const uri = env.DATABASE_URL?.trim()
  if (uri) {
    try {
      const url = new URL(uri)
      if (!['mysql:', 'mysql2:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.port === '0') {
        return { issue: 'invalid_config' }
      }
      // mysql2 decodes each component. Validate them before creating the pool.
      for (const component of [url.hostname, url.username, url.pathname]) decodeURIComponent(component)
      if (isExamplePassword(decodeURIComponent(url.password))) return { issue: 'password_is_example' }
      return { options: { uri } }
    } catch {
      return { issue: 'invalid_config' }
    }
  }

  const { DB_HOST: host, DB_NAME: database, DB_USER: user, DB_PASSWORD: password } = env
  if (!host || !database || !user || !password) return { issue: 'missing_config' }
  const port = Number(env.DB_PORT || 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { issue: 'invalid_config' }
  if (isExamplePassword(password)) return { issue: 'password_is_example' }
  return { options: { host, port, database, user, password } }
}

const failureIssues = new Map<string, string>([
  ['ER_ACCESS_DENIED_ERROR', 'access_denied'],
  ['ER_BAD_DB_ERROR', 'database_not_found'],
  ['ER_DBACCESS_DENIED_ERROR', 'permissions_denied'],
  ['ER_TABLEACCESS_DENIED_ERROR', 'permissions_denied'],
  ['ER_COLUMNACCESS_DENIED_ERROR', 'permissions_denied'],
  ['ER_BAD_FIELD_ERROR', 'schema_error'],
  ['ER_NO_SUCH_TABLE', 'schema_error'],
  ['ECONNREFUSED', 'connection_refused'],
  ['ENOTFOUND', 'host_not_found'],
  ['ETIMEDOUT', 'connection_timeout'],
  ['EHOSTUNREACH', 'host_unreachable'],
])

export function mysqlFailureIssue(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return (typeof code === 'string' && failureIssues.get(code)) || 'database_error'
}
