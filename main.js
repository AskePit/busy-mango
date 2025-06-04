'use strict'
var obsidian = require('obsidian')

// Config

const DO_TESTS = false

// Utils

class IdPool {
    constructor(preoccupiedIds = []) {
        this.freedIdentifiers = []

        if (preoccupiedIds.length === 0) {
            this.nextIdentifier = 0
            return
        }

        preoccupiedIds.sort((a, b) => a - b)

        let isIdeal = true
        for (let i = 0; i < preoccupiedIds.length; i++) {
            if (preoccupiedIds[i] !== i) {
                isIdeal = false
                break
            }
        }

        this.nextIdentifier = preoccupiedIds[preoccupiedIds.length - 1] + 1

        if (!isIdeal) {
            for (let i = 0; i < preoccupiedIds.length; i++) {
                const prevId = i > 0 ? preoccupiedIds[i - 1] : -1
                for (let j = prevId + 1; j < preoccupiedIds[i]; j++) {
                    this.freedIdentifiers.push(j)
                }
            }
        }
    }

    yieldId() {
        if (this.freedIdentifiers.length > 0) {
            return this.freedIdentifiers.pop()
        } else {
            return this.nextIdentifier++
        }
    }

    freeId(identifier) {
        if (!this.isIdFree(identifier)) {
            this.freedIdentifiers.push(identifier)
        }
    }

    isIdFree(identifier) {
        return (
            identifier >= this.nextIdentifier ||
            this.freedIdentifiers.includes(identifier)
        )
    }
}

function keepTrailingWhitespace(op) {
    return function (line, ...args) {
        const left = line.trimEnd()
        const right = line.slice(left.length)
        return op(left, ...args) + right
    }
}

function getHtmlId(line) {
    const headIndex = line.indexOf("<!--")
    if (headIndex === -1) return null

    const tailIndex = line.indexOf("-->", headIndex)
    if (tailIndex === -1) return null

    const data = line.slice(headIndex + 4, tailIndex).trim()
    const [key, value] = data.split(":")

    if (!value || key.trim().toLowerCase() !== "id") return null

    return parseInt(value.trim(), 10)
}

const setHtmlId = keepTrailingWhitespace(function (line, id) {
    const oldId = getHtmlId(line)
    if (oldId === id) return line

    if (oldId === null) {
        return `${line} <!-- id: ${id} -->`
    } else {
        return `${removeHtmlId(line)} <!-- id: ${id} -->`
    }
})

const removeHtmlId = keepTrailingWhitespace(function (line) {
    const headIndex = line.indexOf("<!--")
    if (headIndex === -1) return line
    return line.slice(0, headIndex).trimEnd()
})

function safeToInt(val) {
    return val == null ? null : parseInt(val)
}

// Utils tests

if (DO_TESTS) {
    let testsOk = true

    function checkEq(got, expected) {
        if (got !== expected) {
            testsOk = false
            throw new Error(`expected: "${expected}", got: "${got}"`)
        }
    }

    function checkNeq(x, y) {
        if (x === y) {
            testsOk = false
            throw new Error(`Expected ${x} to not equal ${y}`)
        }
    }

    function tests() {
        try {
            checkEq(getHtmlId("pipipi"), null)
            checkEq(getHtmlId("az\n"), null)
            checkEq(getHtmlId("<!-- 15 -->\n"), null)
            checkEq(getHtmlId("pipipi  <!-- 15 -->"), null)
            checkEq(getHtmlId("pipipi \t<!-- id: 15 -->"), 15)
            checkEq(getHtmlId("text <!-- id: 15 -->\n\t\n"), 15)
            checkEq(getHtmlId(" Task#1 <!-- id: 0 -->\n"), 0)
            checkEq(getHtmlId(" id: 15 id <!-- id:-1 -->\n"), -1)

            checkEq(setHtmlId("pipipi <!-- id: 15 -->\n", 2), "pipipi <!-- id: 2 -->\n")
            checkEq(setHtmlId("<!-- id: 15 -->\n", 15), "<!-- id: 15 -->\n")
            checkEq(setHtmlId(" Task \n", 1), " Task <!-- id: 1 --> \n")
            checkEq(setHtmlId(" Task \n", 1), " Task <!-- id: 1 --> \n")

            if (testsOk) {
                console.log("Tests passed!")
            }
        } catch (err) {
            console.error("Test failed:", err.message)
        }
    }

    tests()
}

// Business logic

class Priority {
    static URGENT = 0
    static HIGH = 1
    static NORMAL = 2
    static LOW = 3
    static NONE = 4

    static fromString(s) {
        if (!s) return Priority.NONE
        s = s.toLowerCase()
        switch (s) {
            case 'urgent': return Priority.URGENT
            case 'high': return Priority.HIGH
            case 'normal': return Priority.NORMAL
            case 'low': return Priority.LOW
            case 'none': return Priority.NONE
            default: return Priority.NONE
        }
    }

    static isConsiderable(priority) {
        return priority <= Priority.NORMAL
    }

    static notConsiderable(priority) {
        return !Priority.isConsiderable(priority)
    }

    static getWeight(priority) {
        switch (priority) {
            case Priority.NONE: return 0
            case Priority.LOW: return 1
            case Priority.NORMAL: return 2
            case Priority.HIGH: return 4
            case Priority.URGENT: return 8
            default: return 2
        }
    }
}

class Todo {
    constructor() {
        this.id = null
        this.desc = ''
        this.link = ''
        this.project = null
        this.board = null
    }

    isUrgent() {
        return this.desc.startsWith('!')
    }

    getUrgency() {
        if (this.isUrgent()) {
            return Priority.URGENT
        } else {
            return this.project.urgency
        }
    }

    getStrategy() {
        return this.project.strategy
    }

    getInterest() {
        return this.project.interest
    }

    toString() {
        return `${this.project.name}: ${this.desc}`
    }
}

const BoardType = {
    DEEP_TODO: 1,
    TODO: 2,
    IN_WORK: 3,
    REPETITIVE: 4
}

class Board {
    constructor() {
        this.id = null
        this.todos = []
        this.project = null
    }

    toString() {
        return `${this.constructor.name}: ${this.todos.map(todo => todo.toString()).join(', ')}`
    }
}

class KanbanBoard extends Board {
    constructor() {
        super()
        this.type = null
    }

    toString() {
        return `${this.type}: ${this.todos.map(todo => todo.toString()).join(', ')}`
    }
}

class MdTopic extends Board {
    constructor() {
        super()
        this.name = ''
    }

    toString() {
        return `${this.name}: ${this.todos.map(todo => todo.toString()).join(', ')}`
    }
}

const ProjectType = {
    KANBAN: 0,
    MD: 1
}

class Project {
    constructor() {
        this.id = null
        this.name = ''
        this.projectType = null
        this.boards = []
        this.urgency = Priority.NONE
        this.strategy = Priority.NONE
        this.interest = Priority.NONE
        this.areas = []
    }

    getTodosByType(type) {
        if (this.projectType === ProjectType.MD) return []
        for (const board of this.boards) {
            if (board.type === type) return board.todos
        }
        return []
    }

    getAvailableTodos() {
        let todos = []
        if (this.projectType === ProjectType.KANBAN) {
            todos = [...this.getTodosByType(BoardType.REPETITIVE)]
            const inWork = this.getTodosByType(BoardType.IN_WORK)
            todos.push(...(inWork.length > 0 ? inWork : this.getTodosByType(BoardType.TODO)))
        } else if (this.projectType === ProjectType.MD) {
            for (const board of this.boards) {
                todos.push(...board.todos)
            }
        }
        return todos
    }

    toString() {
        return `${this.name} (${this.projectType}): ${this.boards.map(b => b.toString()).join(', ')}`
    }
}

class ProjectsLibrary {
    constructor(plugin) {
        this.plugin = plugin
        this.projects = []
        this.projectFileManipulators = []
    }

    async load() {
        const root = this.plugin.app.vault.getFolderByPath(obsidian.normalizePath(this.plugin.save.busyMangoDir))

        for (const file of root.children) {
            if (file instanceof obsidian.TFile) {
                if (file.extension == 'md') {
                    const holder = new ProjectFileManipulator(file, this.plugin)
                    await holder.load()
                    this.projects.push(holder.project)
                    this.projectFileManipulators.push(holder)
                }
            }
        }

        this.fixMissingIds()
    }

    fixMissingIds() {
        const fixIds = (items, setIdCb) => {
            const occupiedIds = []
            const missingIds = []

            items.forEach((item, index) => {
                if (Array.isArray(item)) {
                    item = item[0]
                }

                if (item.id === undefined) {
                    throw new Error('Item missing an ID attribute.')
                }

                if (item.id === null) {
                    missingIds.push(index)
                } else {
                    occupiedIds.push(item.id)
                }
            })

            if (missingIds.length > 0) {
                const idPool = new IdPool(occupiedIds)
                for (const index of missingIds) {
                    const newId = idPool.yieldId()
                    setIdCb(items[index], index, newId)
                }
            }
        }

        const setProjectId = (project, index, id) => {
            const holder = this.projectFileManipulators[index]
            project.id = id
            holder.setProjectId(id)
        }

        fixIds(this.projects, setProjectId)

        this.projects.forEach((project, i) => {
            const holder = this.projectFileManipulators[i]

            const setBoardId = (board, boardIndex, id) => {
                board.id = id
                holder.setBoardId(boardIndex, id)
            }

            fixIds(project.boards, setBoardId)
        })

        const allTodos = []
        this.projects.forEach((project, pIdx) => {
            const holder = this.projectFileManipulators[pIdx]
            project.boards.forEach((board, bIdx) => {
                board.todos.forEach((todo, tIdx) => {
                    allTodos.push([todo, bIdx, tIdx, holder])
                })
            })
        })

        const setTodoId = (todoData, _, id) => {
            const [todo, bIdx, tIdx, holder] = todoData
            todo.id = id
            holder.setTodoId(bIdx, tIdx, id)
        }

        fixIds(allTodos, setTodoId)

        for (const holder of this.projectFileManipulators) {
            holder.flush()
        }
    }

    getAllProjectNames() {
        return this.projects.map(p => p.name)
    }

    getAllProjectFiles() {
        return this.projectFileManipulators.map(p => p.projectFile)
    }

    getAllAreas() {
        const allAreas = new Set()
        for (const p of this.projects) {
            for (const area of p.areas) {
                allAreas.add(area)
            }
        }
        return Array.from(allAreas).sort()
    }

    getAvailableTodos() {
        return this.projects.flatMap(p => p.getAvailableTodos())
    }

    getProjectById(id) {
        for (const p of this.projects) {
            if (p.id === id) return p
        }
        return null
    }

    getTodoById(id) {
        for (const p of this.projects) {
            for (const b of p.boards) {
                for (const t of b.todos) {
                    if (t.id === id) return t
                }
            }
        }
        return null
    }

    toString() {
        return JSON.stringify(this.projects)
    }
}

class ProjectFileManipulator {
    constructor(projectFile, plugin) {
        this.projectFile = projectFile
        this.plugin = plugin
        this.isDirty = false

        // These will be initialized async via load()
        this.frontmatter = {}
        this.head = []
        this.projectLines = []
        this.tail = []

        this.boardLinesIndexes = []
        this.todosLinesIndexes = []

        this.project = null
    }

    async load() {
        await this.plugin.app.fileManager.processFrontMatter(this.projectFile, (frontmatter) => {
            this.frontmatter = frontmatter ?? {}
            this.frontmatter = {
                ...this.frontmatter,
                areas: this.frontmatter.areas ?? [],
                interest: this.frontmatter.interest ?? 'low',
                strategy: this.frontmatter.strategy ?? 'low',
                urgency: this.frontmatter.urgency ?? 'low',
            }
        })

        const fileContent = await this.plugin.app.vault.read(this.projectFile)
        let lines = fileContent.split(/\r?\n/)

        // Detect head (lines before first '##')
        let firstHeadingIndex = lines.findIndex(line => line.startsWith('##'))
        if (firstHeadingIndex === -1) {
            throw new Error(`No headings in file ${this.projectFile}!`)
        }
        this.head = lines.slice(0, firstHeadingIndex)
        lines = lines.slice(firstHeadingIndex)

        // Detect projectLines and tail
        let projectLineSplitIndex = -1
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('- [ ]') || lines[i].trim().startsWith('##')) {
                projectLineSplitIndex = i
                break
            }
        }
        if (projectLineSplitIndex === -1) {
            // If no such lines found, consider all lines projectLines
            this.projectLines = lines
            this.tail = []
        } else {
            this.projectLines = lines.slice(0, projectLineSplitIndex + 1)
            this.tail = lines.slice(projectLineSplitIndex + 1)
        }

        // Determine project type (assume ProjectType enums are globally defined)
        let projectType = this.frontmatter['kanban-plugin'] === undefined ? ProjectType.MD : ProjectType.KANBAN

        // Parse project
        const projectName = this.projectFile.basename
        this.project = this.parseProject(projectName, projectType)

        // Setup parents
        for (const board of this.project.boards) {
            board.project = this.project
            for (const todo of board.todos) {
                todo.project = this.project
                todo.board = board
            }
        }
    }

    parseProject(projectName, projectType) {
        const project = new Project()
        project.name = projectName
        project.projectType = projectType
        project.boards = []

        project.id = safeToInt(this.frontmatter.id)
        project.urgency = Priority.fromString(this.frontmatter.urgency)
        project.strategy = Priority.fromString(this.frontmatter.strategy)
        project.interest = Priority.fromString(this.frontmatter.interest)
        project.areas = this.frontmatter.areas

        this.boardLinesIndexes = []
        this.todosLinesIndexes = []

        this.projectLines.forEach((line, i) => {
            if (line.startsWith('##')) {
                this.boardLinesIndexes.push(i)
                this.todosLinesIndexes.push([])
            }
        })

        if (projectType === ProjectType.MD && this.boardLinesIndexes.length === 0) {
            this.boardLinesIndexes.push(0)
        }

        this.boardLinesIndexes.forEach((boardLineIndex, i) => {
            let boardLines = []
            if (i < this.boardLinesIndexes.length - 1) {
                boardLines = this.projectLines.slice(boardLineIndex, this.boardLinesIndexes[i + 1])
            } else {
                boardLines = this.projectLines.slice(boardLineIndex)
            }
            const parseFunc = projectType === ProjectType.KANBAN ? this.parseKanbanBoard.bind(this) : this.parseMdTopic.bind(this)
            const board = parseFunc(boardLines, i, boardLineIndex)
            project.boards.push(board)
        })

        return project
    }

    parseKanbanBoard(lines, boardIndex, linesOffset) {
        const board = new KanbanBoard()
        let boardName = lines[0].replace(/^##/, '').trim().toLowerCase()
        board.id = getHtmlId(boardName)
        boardName = removeHtmlId(boardName)

        switch (boardName) {
            case 'in work':
                board.type = BoardType.IN_WORK
                break
            case 'todo':
                board.type = BoardType.TODO
                break
            case 'deep todo':
                board.type = BoardType.DEEP_TODO
                break
            case 'repetitive':
                board.type = BoardType.REPETITIVE
                break
            default:
                board.type = BoardType.TODO
        }

        board.todos = []

        lines.forEach((line, i) => {
            if (line.startsWith('- [ ]')) {
                const todo = this.parseTodo(line)
                board.todos.push(todo)
                this.todosLinesIndexes[boardIndex].push(i + linesOffset)
            }
        })

        return board
    }

    parseMdTopic(lines, boardIndex, linesOffset) {
        const board = new MdTopic()

        if (lines[0].startsWith('##')) {
            board.name = lines[0].replace(/^##/, '').trim()
        } else {
            board.name = 'Default'
        }

        board.id = getHtmlId(board.name)
        board.todos = []

        lines = lines.map(line => line.trim())

        lines.forEach((line, i) => {
            if (line.startsWith('- [ ]')) {
                const todo = this.parseTodo(line)
                board.todos.push(todo)
                this.todosLinesIndexes[boardIndex].push(i + linesOffset)
            }
        })

        return board
    }

    parseTodo(line) {
        const todo = new Todo()

        line = line.slice(5) // remove '- [ ]'
        todo.id = getHtmlId(line)
        line = removeHtmlId(line)
        line = line.trim()
        line = line.replace(/\[\[/g, '').replace(/\]\]/g, '')

        todo.desc = line
        return todo
    }

    setProjectId(projectId) {
        this.frontmatter.id = projectId
        this.isDirty = true
    }

    setBoardId(boardIndex, boardId) {
        const boardLineIndex = this.boardLinesIndexes[boardIndex]
        const boardLine = this.projectLines[boardLineIndex]
        this.projectLines[boardLineIndex] = setHtmlId(boardLine, boardId)
        this.isDirty = true
    }

    setTodoId(boardIndex, todoIndex, todoId) {
        const todoLineIndex = this.todosLinesIndexes[boardIndex][todoIndex]
        const todoLine = this.projectLines[todoLineIndex]
        this.projectLines[todoLineIndex] = setHtmlId(todoLine, todoId)
        this.isDirty = true
    }

    async flush() {
        await this.plugin.app.vault.process(this.projectFile, (content) => {
            return [
                ...this.head,
                ...this.projectLines,
                ...this.tail
            ].join('\n')
        })

        await this.plugin.app.fileManager.processFrontMatter(this.projectFile, (frontmatter) => {
            // Clear existing frontmatter
            for (const key in frontmatter) {
                delete frontmatter[key];
            }

            // Copy properties from this.frontmatter
            Object.assign(frontmatter, this.frontmatter);
        })

        this.isDirty = false
    }

    async modifyFileBody(file, fn) {
        await this.plugin.app.vault.process(file, (content) => {
            const match = content.match(/^---\n[\s\S]*?\n---\n?/)
            const frontmatter = match?.[0] ?? ''
            const body = content.slice(frontmatter.length)
            const newBody = fn(body)
            return frontmatter + newBody
        })
    }
}

class History {
    constructor(saveData, getProjectById, getTodoById, saveFunc) {
        this.data = saveData // reference to an object { done: [...], historyCandidate: 42 }
        this.saveFunc = saveFunc
        this.getProjectById = getProjectById
        this.getTodoById = getTodoById
    }

    hasHistoryCandidate() {
        return this.data.currTodo !== null
    }

    getCandidateTodo() {
        return this.getTodoById(this.data.currTodo)
    }

    acceptHistoryCandidate() {
        let projectId = null
        const todo = this.getTodoById(this.data.currTodo)
        if (todo) {
            projectId = todo.project.id
        }
        
        if (!projectId) {
            projectId = this.data.currProject
        }

        this.data.projectsHistory.push(projectId)
        this.data.currProject = null
        this.data.currTodo = null
        this.data.currTodoName = ""
        this.normalize()
    }

    rejectHistoryCandidate() {
        this.data.currProject = null
        this.data.currTodo = null
        this.data.currTodoName = ""
    }

    setHistoryCandidate(todo) {
        this.data.currTodo = todo.id
        this.data.currTodoName = todo.desc
        this.data.currProject = todo.project.id
    }

    save() {
        this.saveFunc()
    }

    normalize() {
        this.data.projectsHistory.reverse()
        const newDone = []
        for (const el of this.data.projectsHistory) {
            if (!newDone.includes(el)) {
                const project = this.getProjectById(el)
                if (project) {
                    newDone.push(el)
                }
            }
        }
        newDone.reverse()
        this.data.projectsHistory = newDone
    }

    printSelf() {
        console.log('History')
        for (const a of this.data.projectsHistory) {
            console.log(a)
        }
    }

    getHistoryProjects() {
        this.normalize()
        return this.data.projectsHistory.map(id => this.getProjectById(id))
    }
}

class Filter {
    constructor({ urgent = false, urgenturgent = false, strategic = false, interesting = false, areaName = '', projectName = '' } = {}) {
        this.urgent = urgent
        this.urgenturgent = urgenturgent
        this.strategic = strategic
        this.interesting = interesting
        this.areaName = areaName
        this.projectName = projectName
    }

    isEmpty() {
        return !(this.urgent || this.urgenturgent || this.strategic || this.interesting || this.areaName || this.projectName)
    }

    filterTodos(todos) {
        if (this.isEmpty()) return todos

        if (this.projectName !== '') {
            return todos.filter(todo => todo.project.name === this.projectName)
        } else if (this.areaName !== '') {
            return todos.filter(todo => todo.project.areas.includes(this.areaName))
        } else {
            return todos.filter(todo =>
                (this.urgenturgent && todo.getUrgency() === Priority.URGENT) ||
                (this.urgent && Priority.isConsiderable(todo.getUrgency())) ||
                (this.strategic && Priority.isConsiderable(todo.getStrategy())) ||
                (this.interesting && Priority.isConsiderable(todo.getInterest()))
            )
        }
    }
}

// Obsidian Plugin

// shuffle array
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)) // random index
        [array[i], array[j]] = [array[j], array[i]];   // swap in-place
    }
}

// How much each dimension affects score
const dimensionWeights = {
    urgency: 100,
    strategy: 10,
    interest: 1
};

// priority-weighted shuffle
// more prioritized — nearer to the beginning of array
function weightedShuffle(todos) {
    const scored = todos.map(todo => {
        const urgencyScore = -Math.log(Math.random()) * Priority.getWeight(todo.getUrgency()) * dimensionWeights.urgency;
        const strategyScore = -Math.log(Math.random()) * Priority.getWeight(todo.getStrategy()) * dimensionWeights.strategy;
        const interestScore = -Math.log(Math.random()) * Priority.getWeight(todo.getInterest()) * dimensionWeights.interest;

        return [todo, urgencyScore + strategyScore + interestScore]
    })

    return scored
        .sort((a, b) => b[1] - a[1])
        .map(([todo]) => todo)
}

// priority-weighted sort
// more prioritized — nearer to the beginning of array
function biasedSort(todos) {
    const scored = todos.map((todo, index) => {
        const urgencyBump = -Math.log(Math.random()) * Priority.getWeight(todo.getUrgency()) * dimensionWeights.urgency;
        const strategyBump = -Math.log(Math.random()) * Priority.getWeight(todo.getStrategy()) * dimensionWeights.strategy;
        const interestBump = -Math.log(Math.random()) * Priority.getWeight(todo.getInterest()) * dimensionWeights.interest;

        return [todo, index - (urgencyBump + strategyBump + interestBump)]
    })

    return scored
        .sort((a, b) => a[1] - b[1])
        .map(([todo]) => todo)
}

function capitalize(word) {
    if (!word) return ''
    return word[0].toUpperCase() + word.slice(1).toLowerCase()
}

class BusyMangoPlugin extends obsidian.Plugin {
    projectsLibrary = null
    save
    loaded // Promise<void>
    viewRegistered = false
    loadedCallback // () => void

    async onload() {
        this.loaded = new Promise(resolve => {
            this.loadedCallback = resolve
        })

        this.viewRegistered = false

        this.addRibbonIcon('bean', 'Busy Mango', (evt) => {
            if (!this.viewRegistered) {
                this.registerView(
                    VIEW_TYPE_BUSY_MANGO,
                    (leaf) => new BusyMangoView(leaf, this)
                )
                this.viewRegistered = true
            }
            this.activateView()
        })

        this.save = await this.loadData() ?? {}
        this.save = {
            ...this.save,
            busyMangoDir: this.save.busyMangoDir ?? "/",
            projectsHistory: this.save.projectsHistory ?? [],
            currProject: this.save.currProject ?? null,
            currTodo: this.save.currTodo ?? null,
            currTodoName: this.save.currTodoName ?? ""
        }

        this.deactivateView()

        this.app.workspace.onLayoutReady(async () => {
            this.deactivateView()
            this.projectsLibrary = new ProjectsLibrary(this)
            await this.projectsLibrary.load()

            this.history = new History(
                this.save,
                (id) => this.projectsLibrary.getProjectById(id),
                (id) => this.projectsLibrary.getTodoById(id),
                () => this.saveData(this.save)
            )
            this.loadedCallback()
        })

        this.addSettingTab(new BusyMangoSettingTab(this.app, this))
    }

    async confirmPreviousTaskCompletion() {
        if (!this.history.hasHistoryCandidate()) return

        let todoDesc = ''
        let todoProjectName = ''

        const candidateTodo = this.history.getCandidateTodo()

        if (candidateTodo) {
            todoDesc = candidateTodo.desc
            todoProjectName = candidateTodo.project.name
        } else {
            todoDesc = this.save.currTodoName
            const projectId = this.save.currProject
            const project = this.projectsLibrary.getProjectById(projectId)
            todoProjectName = project ? project.name : 'Unknown Project'
        }

        if (candidateTodo) {
            const ans = await new QuestionModal(
                `Did you finish`,
                `${capitalize(todoProjectName)}: ${todoDesc}?`,
                this.app
            ).openAndWait()

            if (ans) {
                this.history.acceptHistoryCandidate()
            } else {
                this.history.rejectHistoryCandidate()
            }
        }

        this.history.save()
    }

    async activateView() {
        const { workspace } = this.app

        let leaf = null
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_BUSY_MANGO)

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0]
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            leaf = workspace.getLeaf('tab') // opens a tab in a central pane
            await leaf.setViewState({ type: VIEW_TYPE_BUSY_MANGO, active: true })
        }

        // "Reveal" the leaf in case it is in a collapsed sidebar
        workspace.revealLeaf(leaf)
    }

    deactivateView() {
        const { workspace } = this.app
        workspace.detachLeavesOfType(VIEW_TYPE_BUSY_MANGO)
    }

    async suggest(filter) {
        const allTodos = filter.filterTodos(this.projectsLibrary.getAvailableTodos())

        const historyProjects = this.history.getHistoryProjects()
        let historyTodos = historyProjects.flatMap(p => p.getAvailableTodos())
        historyTodos = filter.filterTodos(historyTodos)
        let notRegisteredTodos = allTodos.filter(x => !historyTodos.includes(x))

        // first: not registered shuffled todos, then - todos in history order
        notRegisteredTodos = weightedShuffle(notRegisteredTodos)
        historyTodos = biasedSort(historyTodos)
        const todos = [...notRegisteredTodos, ...historyTodos]

        // console.log(todos)

        if (todos.length === 0) {
            new Notice('No todos found for the given filter!')
            return
        } 

        for (const suggestion of todos) {
            const accepted = await new QuestionModal(
                capitalize(suggestion.project.name),
                suggestion.desc,
                this.app
            ).openAndWait()

            if (accepted) {
                this.history.setHistoryCandidate(suggestion)
                this.history.save()
                this.deactivateView()
                return
            }
        }

        // if you're here, there is no todos for you
        new Notice('No todos for you!')
    }

    onunload() {
        this.deactivateView()
    }
}

class QuestionModal extends obsidian.Modal {
    resolveCb // (result: boolean) => void

    constructor(questionTitle, questionText, app) {
        super(app)
        this.setTitle(questionTitle)
        this.setContent(questionText)
        new obsidian.Setting(this.contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText('Yes')
                    .setCta()
                    .onClick(() => {
                        this.close()
                        this.resolveCb(true)
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText('No')
                    .onClick(() => {
                        this.close()
                        this.resolveCb(false)
                    })
            )
    }

    onOpen() {
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }

    openAndWait() { // -> Promise<boolean>
        this.open()
        return new Promise(resolve => {
            this.resolveCb = resolve
        })
    }
}

const VIEW_TYPE_BUSY_MANGO = 'busy-mango-view'

class BusyMangoView extends obsidian.ItemView {
    plugin = null

    constructor(leaf, plugin) {
        super(leaf)
        this.plugin = plugin
        this.icon = 'bean'
    }

    getViewType() {
        return VIEW_TYPE_BUSY_MANGO
    }

    getDisplayText() {
        return 'Busy Mango'
    }

    async onOpen() {
        const container = this.containerEl.children[1]
        container.empty()
        container.createEl('h4', { text: 'Busy Mango' })

        container.createEl('button', { text: 'Any' }).on("click", "button", () => {
            this.#initSuggestion(new Filter())
        })

        container.createEl('button', { text: 'Urgent Urgent' }).on("click", "button", () => {
            this.#initSuggestion(new Filter({ urgenturgent: true }))
        })

        container.createEl('button', { text: 'Urgent' }).on("click", "button", () => {
            this.#initSuggestion(new Filter({ urgent: true }))
        })

        container.createEl('button', { text: 'Strategic' }).on("click", "button", () => {
            this.#initSuggestion(new Filter({ strategic: true }))
        })

        container.createEl('button', { text: 'Interesting' }).on("click", "button", () => {
            this.#initSuggestion(new Filter({ interesting: true }))
        })

        this.app.workspace.onLayoutReady(async () => {
            await this.plugin.loaded

            container.createEl('h5', { text: 'Areas' })

            for (const area of this.plugin.projectsLibrary.getAllAreas()) {
                container.createEl('button', { text: area }).on("click", "button", () => {
                    this.#initSuggestion(new Filter({ areaName: area }))
                })
            }

            container.createEl('h5', { text: 'Projects' })

            for (const project of this.plugin.projectsLibrary.projects) {
                container.createEl('button', { text: project.name }).on("click", "button", () => {
                    this.#initSuggestion(new Filter({ projectName: project.name }))
                })
            }

            this.plugin.confirmPreviousTaskCompletion()
        })
    }

    async onload() {
        const container = this.containerEl.children[1]
    }

    async onClose() {
        // Nothing to clean up.
    }

    #initSuggestion(filter) {
        this.plugin.suggest(filter)
    }
}

class BusyMangoSettingTab extends obsidian.PluginSettingTab {
    plugin

    constructor(app, plugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    display() {
        let { containerEl } = this

        containerEl.empty()

        new obsidian.Setting(containerEl)
            .setName('Projects Folder')
            .setDesc('Root folder for Busy Mango')
            .addText((text) =>
                text
                    .setPlaceholder('/')
                    .setValue(this.plugin.save.busyMangoDir)
                    .onChange(async (value) => {
                        this.plugin.save.busyMangoDir = value
                        await this.plugin.saveData(this.plugin.save)
                    })
            )
    }
}

module.exports = BusyMangoPlugin
