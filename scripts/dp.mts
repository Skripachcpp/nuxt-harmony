import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import chalk from "chalk"

const __dirname = path.dirname(import.meta.dirname)

// #region вывод дерева в консоль

function isFileSync(path) {
  try {
    return fs.statSync(path).isFile()
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error("Файл не существует!")
    } else {
      console.error("Ошибка:", err.message)
    }
    return false
  }
}

export type TreeParse = {
  name: string
  children: TreeParse[]
  color?: string
}

export function treeParse(
  tree: TreeParse[],
  level?: number,
  parentPre?: string,
  treeStr?: string[]
): string[] {
  if (!level) level = 0
  if (!parentPre) parentPre = ""
  if (!treeStr) treeStr = []
  if (!tree) return treeStr

  if (!check(tree, level)) return []

  tree.forEach(function (child, index) {
    const hasNext = !!tree[index + 1]
    const children = child.children

    treeStr?.push(
      ""
        .concat(setPre(level, hasNext, parentPre))
        .concat(
          child.color
            ? chalk.hex(child.color)(child.name)
            : stringToColor(child.name)(child.name)
        )
    )

    if (children) {
      treeParse(
        children,
        level + 1,
        setTransferPre(parentPre, hasNext),
        treeStr
      )
    }
  })

  return treeStr
}

function check(tree: unknown, level: number) {
  if (typeof tree !== "object") return false
  if (level >= 1000) return false
  return true
}

function setPre(level: number, hasNext?: boolean, parentPre?: string) {
  return "".concat(parentPre || "").concat(hasNext ? "├" : "└", "\u2500\u2500 ")
}

function setTransferPre(parentPre?: string, hasNext?: boolean) {
  return "".concat(parentPre || "").concat(hasNext ? "│" : " ", "   ")
}

// #endregion

// #region красивая консоль

function stringToColor(str: string) {
  // Создаем хеш из строки
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  // Преобразуем хеш в цвет
  let color = "#"
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff
    color += ("00" + value.toString(16)).slice(-2)
  }

  return chalk.hex(color)
}

// #endregion

// #region работа с файлами

const readFileAsync = promisify(fs.readFile)

function findFiles(
  dirPath: string,
  ignorePaths?: string[],
  _arrayOfFiles?: string[]
): string[] {
  const files = fs.readdirSync(dirPath)
  if (!_arrayOfFiles) _arrayOfFiles = []

  files.forEach(function (file) {
    if (ignorePaths) {
      for (const ignorePath of ignorePaths) {
        if (file.includes(ignorePath)) {
          return
        }
      }
    }

    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      _arrayOfFiles = findFiles(
        dirPath + "/" + file,
        ignorePaths,
        _arrayOfFiles
      )
    } else {
      if (!_arrayOfFiles) _arrayOfFiles = []
      _arrayOfFiles.push(path.resolve(dirPath, file))
    }
  })

  return _arrayOfFiles
}

// #endregion

// #region прочее

function initFlags(objFlags: { [key: string]: boolean } = {}) {
  const argv = process.argv.filter((a, i) => i > 1)
  const flags = Object.keys(objFlags)

  let atherSkip = false
  for (const arg of argv) {
    if (!atherSkip && flags.includes(arg)) {
      objFlags[arg.toString()] = true
    } else {
      atherSkip = true
    }
  }
}

// #endregion

// ##--##--##--##--##--##--##

type CmpImportInfo = {
  line?: string
  pathRelative?: string
  pathFull?: string
  textOfImportedFile?: string
}

type CmpElement = {
  pathFull: string
  content?: string
  imports?: CmpImportInfo[]
  parentLevels?: number[]
  parentMinLevel?: number
  children?: CmpElement[]
  parent?: CmpElement[]
  root?: boolean
}

type CmpByPath = {
  [pathFull: string]: CmpElement
}

async function readComponents(pathFull: string): Promise<CmpByPath> {
  const files = findFiles(pathFull).filter(
    (a) => a.includes(".tsx") && !a.includes(".test.") && !a.includes("._test.")
  )

  const cmpByPath: CmpByPath = {}

  // читаем файлы
  const readTasks: Promise<void>[] = []
  for (const pathFull of files) {
    cmpByPath[pathFull] = { pathFull }
    const task = readFileAsync(pathFull).then((a) => {
      cmpByPath[pathFull].content = a.toString()
    })

    readTasks.push(task)
  }

  await Promise.all(readTasks)

  return cmpByPath
}

async function initImports(cmpByPath: CmpByPath) {
  const readTasks: Promise<void>[] = []

  // собираем импорты на файлы в проекте
  const rxImports = "import(.*)from [', \"](.*)[', \"]"
  for (const pathFull in cmpByPath) {
    const content = cmpByPath[pathFull].content
    if (!content) continue

    const importsMatched = content.match(new RegExp(rxImports, "g"))

    // пропускаем tsx где нет import-ов
    if (!importsMatched) continue

    for (const importMatched of importsMatched) {
      const imps = importMatched.match(new RegExp(rxImports))
      if (!imps) {
        continue
      }

      const importPathRelative = imps[2].trim()

      let importPath = importPathRelative

      // css не интересует
      if (importPath.includes(".css")) continue

      const importPathArray = importPath?.split("/")

      if (importPath.includes("bottom-child"))
        if (importPathArray?.[0] == "~") {
          // собираем импорты только компонентов
          if (
            importPathArray?.[1] != "components" &&
            importPathArray?.[1] != "shared"
          ) {
            continue
          }

          importPath = importPathArray?.slice(1).join("/")
          importPath = path.resolve(__dirname, importPath)
        } else if (importPath?.[0] == ".") {
          // автоматом резолвит ./ ../ ../..
          importPath = path.resolve(path.dirname(pathFull), importPath)
        } else {
          // импорт который начинается не с ~ и не с .
          // это не похоже на импорт компонента
          continue
        }

      const imp: CmpImportInfo = {
        line: imps[0],
        pathRelative: importPathRelative,
        pathFull: importPath,
      }

      if (fs.existsSync(imp.pathFull + ".tsx")) {
        imp.pathFull = imp.pathFull + ".tsx"
      } else if (fs.existsSync(imp.pathFull + ".ts")) {
        imp.pathFull = imp.pathFull + ".ts"
      }

      // если файл существует
      // TODO: тут посему то проскакивают папки
      if (imp.pathFull && fs.existsSync(imp.pathFull)) {
        // возможно это папка
        // if (!isFileSync(imp.pathFull)) {
        //   const nextPath = imp.pathFull + "/index.tsx"
        //   if (isFileSync(nextPath)) {
        //     imp.pathFull = nextPath
        //   }
        // }

        // console.log("DEBUG 1???0.1", {
        //   p: imp.pathFull,
        //   ex: fs.existsSync(imp.pathFull),
        // })
        const task = readFileAsync(imp.pathFull).then((a) => {
          imp.textOfImportedFile = a.toString()
        })

        readTasks.push(task)

        if (!cmpByPath?.[pathFull]?.imports) cmpByPath[pathFull].imports = []

        // ts рукается поэтому такой странный код
        const imps = cmpByPath[pathFull].imports
        if (imps != null) imps.push(imp)
      }

      cmpByPath[pathFull].content = undefined
    }
  }

  await Promise.all(readTasks)

  // удаляем из списка файлы без импорта
  for (const pathFull in cmpByPath) {
    if (!cmpByPath[pathFull].imports) {
      delete cmpByPath[pathFull]
    }
  }
}

function pathToRelativePath(path: string): string {
  return path.replace(__dirname + "/", "")
}

// !!--!!--!!--!!--!!--!!--!!

async function main() {
  const args = {
    tree: false,

    paths: false,
    path: false,

    validate: false,
    nofix: false,
    help: false,
  }

  initFlags(args)

  if (args.path) args.paths = true

  if (args.help) {
    console.log("все компоненты могут ссылаться только:")
    console.log("1. на уровне своей папки в своей директории")
    console.log("2. в своей директории на уровни ниже")
    console.log(
      "3. на компоненты в components на уровень 0 или 1 если это файлы а не папка"
    )
    console.log(
      "4. все на кого ссылаются pages должны лежать в корневой папке components"
    )
    console.log()
    console.log("можно посмотреть дерево зависимостей флагом tree")
    console.log(
      "если после флага tree написать имя компонента то будет поиск по компоненту"
    )
    console.log("если написать paths то вместо имен будут пути")

    return
  }

  // если надо поискать зависимости для какого то компонента
  let findComponentInTree: null | string = null

  // включаем вместе и там и там показывает дерево
  // только вместо названий компонентов показать где лежит файл
  if (args.paths) args.tree = true

  if (args.validate == false && args.nofix == false && args.tree) {
    const argv = process.argv
    const argvTarget = argv.filter((a, i) => i > 1)
    findComponentInTree = argvTarget.splice(1).join(" ")
  }

  // ищем файлы
  let anyChanges = false

  const pagesCmpByPath = await readComponents("./pages")
  const componentsCmpByPath = await readComponents("./components")

  //  const layoutsCmpByPath = await readComponents('./layouts')
  //  const sharedCmpByPath = await readComponents('./shared')

  //  Object.assign(pagesCmpByPath, layoutsCmpByPath)
  //  Object.assign(componentsCmpByPath, sharedCmpByPath)

  await Promise.all([
    initImports(pagesCmpByPath),
    initImports(componentsCmpByPath),
  ])

  const errorAccumulator = new Set<string>()

  function initChildren(
    cmpElement: CmpElement,
    level = 0,
    parentsAll: CmpElement[] = []
  ) {
    parentsAll = [...parentsAll]

    if (parentsAll.includes(cmpElement)) {
      const color0 = chalk.hex("#CD5C5C")
      const color1 = chalk.hex("#FF2400")

      const index = parentsAll.findIndex((a) => a == cmpElement)
      const prnts = [...parentsAll]
      prnts.splice(0, index - 1)

      errorAccumulator.add(
        [
          color0("ошибка циклические зависимости"),
          color0(
            prnts
              .map((parent) => pathToRelativePath(parent.pathFull))
              .join(" => ")
          ),
          color1(pathToRelativePath(cmpElement.pathFull)),
        ].join(" ")
      )

      return
    }

    parentsAll.push(cmpElement)

    if (level > 50) return

    if (cmpElement == null) return

    if (cmpElement.parentLevels == null) cmpElement.parentLevels = []
    if (!cmpElement.parentLevels.includes(level))
      cmpElement.parentLevels.push(level)

    if (cmpElement.parentMinLevel == null) {
      cmpElement.parentMinLevel = level
    } else {
      if (cmpElement.parentMinLevel >= level) {
        cmpElement.parentMinLevel = level
      }
    }

    for (const imp of cmpElement.imports || []) {
      const { pathFull: importPath } = imp
      if (!importPath) continue

      // ищем в списке компонентов зависимость
      let impCmp = componentsCmpByPath[importPath]
      if (impCmp == null) {
        impCmp = componentsCmpByPath[importPath + "/index.tsx"]
      }

      if (impCmp) {
        if (!cmpElement.children) cmpElement.children = []

        cmpElement.children.push(impCmp)
        if (impCmp.imports) {
          initChildren(impCmp, level + 1, parentsAll)
        }
      }
    }

    // 1 файл может быть импортирован 2 раза как зависимость и как типы
    const alreadyMet: { [path: string]: boolean } = {}
    cmpElement.children = cmpElement.children?.filter((it) => {
      if (!it.pathFull) return false
      if (alreadyMet[it.pathFull]) return false

      return (alreadyMet[it.pathFull] = true)
    })
  }

  function initParents(
    cmpElement: CmpElement,
    level = 0,
    parentsAll: CmpElement[] = []
  ) {
    parentsAll = [...parentsAll]
    if (parentsAll.includes(cmpElement)) {
      const color0 = chalk.hex("#CD5C5C")
      const color1 = chalk.hex("#FF2400")

      const index = parentsAll.findIndex((a) => a == cmpElement)
      const prnts = [...parentsAll]
      prnts.splice(0, index - 1)

      errorAccumulator.add(
        [
          color0("ошибка циклические зависимости"),
          color0(
            prnts
              .map((parent) => pathToRelativePath(parent.pathFull))
              .join(" => ")
          ),
          color1(pathToRelativePath(cmpElement.pathFull)),
        ].join(" ")
      )

      return
    }
    parentsAll.push(cmpElement)

    // на всякий случай контролируем глубину
    if (level > 50) return
    if (cmpElement == null) return

    for (const children of cmpElement.children || []) {
      if (children.parent == null) children.parent = []
      children.parent.push(cmpElement)
      initParents(children, level + 1, parentsAll)
    }
  }

  for (const rootPath in pagesCmpByPath) {
    const rootElement = pagesCmpByPath[rootPath]
    rootElement.root = true
    initChildren(rootElement)
    initParents(rootElement)
  }

  const reverseTree: CmpByPath = {}
  function initReverseTree(
    cmpElement: CmpElement,
    level = 0,
    parentsAll: CmpElement[] = []
  ) {
    parentsAll = [...parentsAll]
    if (parentsAll.includes(cmpElement)) {
      const color0 = chalk.hex("#CD5C5C")
      const color1 = chalk.hex("#FF2400")

      const index = parentsAll.findIndex((a) => a == cmpElement)
      const prnts = [...parentsAll]
      prnts.splice(0, index - 1)

      errorAccumulator.add(
        [
          color0("ошибка циклические зависимости"),
          color0(
            prnts
              .map((parent) => pathToRelativePath(parent.pathFull))
              .join(" => ")
          ),
          color1(pathToRelativePath(cmpElement.pathFull)),
        ].join(" ")
      )

      return
    }
    parentsAll.push(cmpElement)

    if (level > 50) return
    if (cmpElement == null) return
    if (cmpElement.pathFull == null) return

    for (const children of cmpElement.children || []) {
      initReverseTree(children, level + 1, parentsAll)
    }

    if (!cmpElement.children?.length) {
      reverseTree[cmpElement.pathFull] = cmpElement
    }
  }

  for (const pagesPath in pagesCmpByPath) {
    const pagesElement = pagesCmpByPath[pagesPath]
    initReverseTree(pagesElement)
  }

  function pathToComponentName(path: string) {
    let name = path

    const relativePathArray = path?.split("/")
    if (relativePathArray[relativePathArray.length - 1] == "index.tsx") {
      name = relativePathArray[relativePathArray.length - 2]
    } else {
      name = relativePathArray[relativePathArray.length - 1]
    }

    if (name == "pages") {
      name = "index.tsx"
    }

    return name
  }

  type ConsoleTree = Omit<TreeParse, "children"> & {
    children: ConsoleTree[]
    order?: number
  }

  let consoleTree: ConsoleTree[] = []

  function mapTsxElement2ConsoleTree(
    tsxElement: CmpElement,
    level = 0
  ): ConsoleTree[] {
    if (tsxElement == null) return []
    if (level > 4) return []

    const consoleTreeElements: ConsoleTree[] = []

    for (const chd of tsxElement.children || []) {
      if (!chd?.pathFull) continue

      let name = pathToComponentName(chd.pathFull)
      if (args.paths)
        name = chd.pathFull
          .replace(__dirname + "/", "")
          .replace("/index.tsx", "")

      const element: ConsoleTree = {
        name,
        children: mapTsxElement2ConsoleTree(chd, level + 1),
      }
      consoleTreeElements.push(element)

      // подсвечиваем root элементы
      // там можно ссылаться на элементы в папке, но это редкость
      if (
        chd.pathFull
          .replace(__dirname + "/", "")
          .replace("/index.tsx", "")
          ?.split("/").length <= 2
      )
        element.color = "#FFFFFF"
    }

    return consoleTreeElements
  }

  for (const pagesPath in pagesCmpByPath) {
    const element = pagesCmpByPath[pagesPath]

    const relativePath = pagesPath.replace(__dirname, "")

    consoleTree.push({
      name: pathToComponentName(relativePath),
      children: mapTsxElement2ConsoleTree(element),
    })
  }

  function initOrder(element: ConsoleTree): number {
    let count = 0
    if (element == null) return count

    count = element.children?.length || 0

    for (const children of element.children || []) {
      count = count + initOrder(children) || 0
    }

    element.order = count

    return count
  }

  for (const element of consoleTree) initOrder(element)

  consoleTree = consoleTree.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  function sortChildren(element: ConsoleTree) {
    if (element == null) return
    if (!element.children?.length) return

    element.children = element.children.sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )

    for (const children of element.children || []) {
      // @ts-expect-error на что то совсем непонятное тут ругается
      sortChildren(children) || 0
    }
  }

  for (const element of consoleTree) sortChildren(element)

  function findCmpChildren(it: ConsoleTree): ConsoleTree[] {
    if (it == null || it.children == null) return []

    const nextCld = []
    for (const cld of it.children) {
      const children = findCmpChildren(cld)

      if (cld.name == findComponentInTree || children?.length) {
        nextCld.push({ name: cld.name, children })
      }
    }

    return nextCld
  }

  if (findComponentInTree) {
    const nextTree = []

    for (const it of consoleTree) {
      const children = findCmpChildren(it)
      if (it.name == findComponentInTree || children?.length) {
        nextTree.push({ ...it, children })
      }
    }

    consoleTree = nextTree
  }

  if (args.tree) {
    const treeStrArray = treeParse(consoleTree)
    for (const str of treeStrArray) {
      console.log(str)
    }
  }

  const cmpUsed: { [pathFull: string]: boolean } = {}

  function initCmpUsed(cmpElement: CmpElement, parentsAll: CmpElement[] = []) {
    parentsAll = [...parentsAll]
    if (parentsAll.includes(cmpElement)) {
      const color0 = chalk.hex("#CD5C5C")
      const color1 = chalk.hex("#FF2400")

      const index = parentsAll.findIndex((a) => a == cmpElement)
      const prnts = [...parentsAll]
      prnts.splice(0, index - 1)

      errorAccumulator.add(
        [
          color0("ошибка циклические зависимости"),
          color0(
            prnts
              .map((parent) => pathToRelativePath(parent.pathFull))
              .join(" => ")
          ),
          color1(pathToRelativePath(cmpElement.pathFull)),
        ].join(" ")
      )

      return
    }
    parentsAll.push(cmpElement)

    if (cmpElement == null) return
    if (!cmpElement.pathFull) return

    cmpUsed[cmpElement.pathFull] = true

    for (const children of cmpElement.children || []) {
      if (!children?.pathFull) continue

      cmpUsed[children.pathFull] = true
      initCmpUsed(children, parentsAll)
    }
  }

  for (const pagesPath in pagesCmpByPath) {
    initCmpUsed(pagesCmpByPath[pagesPath])
  }

  if (errorAccumulator.size > 0) {
    errorAccumulator.forEach((message) => {
      console.log(message)
    })
  }

  const cmpNotUsed: { [pathFull: string]: boolean } = {}
  const allParents: { [pathFull: string]: boolean } = {}

  for (const pathFull in componentsCmpByPath) {
    if (!cmpUsed[pathFull]) {
      cmpNotUsed[pathFull] = true

      for (const imp of componentsCmpByPath[pathFull].imports ?? []) {
        if (!imp.pathFull) continue

        const impCmp = componentsCmpByPath[imp.pathFull]
        if (impCmp == null) allParents[imp.pathFull + "/index.tsx"] = true
        else allParents[imp.pathFull ?? ""] = true
      }
    }
  }

  // интересуют неиспользуемые компоненты самого верхнего уровня
  for (const pathFull in cmpNotUsed) {
    if (allParents[pathFull]) {
      delete cmpNotUsed[pathFull]
    }
  }

  console.log()
  for (const pathFull in cmpNotUsed) {
    let color0 = chalk.hex("#CD5C5C")
    let color1 = chalk.hex("#FF2400")

    const pathRelativeArray = pathToRelativePath(pathFull)
      .split(path.sep)
      .filter((p) => p)

    if (pathRelativeArray?.[0] == "shared" && pathRelativeArray.length <= 3) {
      color0 = chalk.hex("#FFEC8B")
      color1 = chalk.hex("#FCE883")
    } else {
      anyChanges = true
    }

    console.log(
      color0("не используется"),
      color1([pathFull.replace(__dirname + "/", "")].join(" "))
    )
  }
  console.log()

  function checkPaths(componentElement: CmpElement) {
    if (!componentElement?.parent?.length) return

    const componentParentsSet = new Set<string>()
    for (const parentElement of componentElement.parent || []) {
      const relativePath = parentElement.pathFull.replace(__dirname + "/", "")

      if (!relativePath.startsWith("components/")) continue

      componentParentsSet.add(relativePath)
    }

    const componentParents = [...componentParentsSet].map((a) =>
      a.split("/").filter((a) => a != "index.tsx")
    )

    let componentPath = componentElement.pathFull
      .replace(__dirname + "/", "")
      .split("/")
    componentPath = componentPath.filter((a) => a != "index.tsx")

    // комопненты которые лежат в components надо проверить только на то что их может надо положить пониже
    if (componentPath.length <= 2) {
      // если на него не ссылается pages
      if (
        !componentElement.parent.some(
          (parentElement) =>
            !parentElement.pathFull
              .replace(__dirname + "/", "")
              .startsWith("components/")
        )
      ) {
        // то можно проверять можно ли положить его пониже
        const componentElementRelativePath = componentElement.pathFull.replace(
          __dirname + "/",
          ""
        )

        const relativePaths = []
        for (const parentElement of componentElement.parent || []) {
          const relativePath = path
            .dirname(parentElement.pathFull.replace(__dirname + "/", ""))
            .split("/")
          relativePaths.push(relativePath)
        }

        let canMove = true
        const relativePath = relativePaths?.[0]
        for (const index in relativePath || []) {
          const part = relativePath[index]

          if (
            relativePaths.some((p) => {
              if (p[index] != part) {
                return true
              }

              return false
            })
          ) {
            canMove = false
            break
          }
        }

        if (
          canMove &&
          !(
            componentElementRelativePath.startsWith("shared/") &&
            relativePath[0] === "components"
          )
        ) {
          const color0 = chalk.hex("#CD5C5C")
          const color1 = chalk.hex("#FF2400")
          console.log(
            color0("перенести "),
            color1(componentElementRelativePath),
            color0("в"),
            color1(relativePaths?.[0].join("/"))
          )
          anyChanges = true
        }
      }

      return
    }

    for (const componentParent of componentParents) {
      if (componentParent.length > componentPath.length) {
        const color0 = chalk.hex("#CD5C5C")
        const color1 = chalk.hex("#FF2400")
        console.log(
          color0("parent"),
          color1(componentParent.join("/")),
          color0("deeper than dependence"),
          color1(componentPath.join("/"))
        )
        anyChanges = true
      } else {
        const folderParent = componentParent.filter(
          (a, i) => i < componentParent.length - 1
        )
        const folderComponent = componentPath.filter(
          (a, i) => i < componentParent.length - 1
        )

        if (folderParent.join("/") != folderComponent.join("/")) {
          const color0 = chalk.hex("#CD5C5C")
          const color1 = chalk.hex("#FF2400")
          console.log(
            color0("родитель "),
            color1(componentParent.join("/")),
            color0("в другом подкаталоге, чем зависимость"),
            color1(componentPath.join("/"))
          )
          anyChanges = true
        }
      }
    }
  }

  for (const componentFullPath in componentsCmpByPath) {
    const componentElement = componentsCmpByPath[componentFullPath]
    checkPaths(componentElement)
  }

  for (const componentFullPath in pagesCmpByPath) {
    const componentElement = pagesCmpByPath[componentFullPath]
    for (const children of componentElement.children || []) {
      const relativePath = children.pathFull
        .replace(__dirname + "/", "")
        .replace("/index.tsx", "")
      const relativePathArray = relativePath?.split("/")
      if (relativePathArray[relativePathArray.length - 1].includes(".tsx")) {
        relativePathArray.pop()
      }

      if (relativePathArray.length > 2) {
        const color0 = chalk.hex("#CD5C5C")
        const color1 = chalk.hex("#FF2400")
        console.log(
          color0("page"),
          color1(pathToComponentName(componentFullPath)),
          color0("не может использовать компонент не верхнего уровня"),
          color1(relativePath)
        )
      }
    }
  }

  let count = 0
  for (let key in componentsCmpByPath) {
    count = count + 1

    if (key) {
      key = key?.toString()
    }
  }

  const color = chalk.hex("#1CAC78")
  console.log()
  console.log(color("в проекте пока всего", count, "компонент(ов)"))
  console.log()

  if (anyChanges) {
    console.error("")
    console.error(
      "❌ расположение файлов не соответствует задумке автора проекта ❌"
    )
    console.error("")
    process.exit(1)
  }

  process.exit(0)
}

main()
