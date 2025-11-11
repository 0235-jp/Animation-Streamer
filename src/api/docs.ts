import path from 'node:path'
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yamljs'

export const createDocsRouter = () => {
  const router = Router()
  const documentPath = path.resolve(process.cwd(), 'docs/openapi.yaml')
  const document = YAML.load(documentPath)
  router.use('/', swaggerUi.serve, swaggerUi.setup(document))
  return router
}
