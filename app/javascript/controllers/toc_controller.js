import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { projectId: String, currentElementId: String }
  static targets = ["tree"]

  get csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content
  }

  get baseUrl() {
    return `/projects/${this.projectIdValue}/source_elements`
  }

  // Add a top-level element (from the bottom bar buttons)
  async addRootElement(event) {
    const type = event.currentTarget.dataset.elementType
    const needsTitle = ["chapter", "section", "subsection", "preface", "appendix"].includes(type)
    let title = null

    if (needsTitle) {
      title = prompt(`Enter a title for the new ${type}:`)
      if (title === null) return
    }

    await this.#createElement({ element_type: type, title, parent_id: null })
  }

  // Add a child element (from the + buttons inside container nodes)
  async addChildElement(event) {
    const type = event.currentTarget.dataset.elementType
    const parentId = event.currentTarget.dataset.parentId
    const needsTitle = ["chapter", "section", "subsection", "preface", "appendix"].includes(type)
    let title = null

    if (needsTitle) {
      title = prompt(`Enter a title for the new ${type}:`)
      if (title === null) return
    }

    await this.#createElement({ element_type: type, title, parent_id: parentId })
  }

  // Rename an element
  async renameElement(event) {
    const elementId = event.currentTarget.dataset.elementId
    const newTitle = prompt("Enter a new title:")
    if (newTitle === null || newTitle.trim() === "") return

    try {
      const response = await fetch(`${this.baseUrl}/${elementId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": this.csrfToken
        },
        body: JSON.stringify({ source_element: { title: newTitle.trim() } })
      })

      if (response.ok) {
        window.location.reload()
      } else {
        alert("Failed to rename element.")
      }
    } catch (error) {
      console.error("Error renaming element:", error)
      alert("An error occurred.")
    }
  }

  // Delete an element
  async deleteElement(event) {
    const elementId = event.currentTarget.dataset.elementId
    const elementTitle = event.currentTarget.dataset.elementTitle
    const hasChildren = event.currentTarget.dataset.hasChildren === "true"

    const warning = hasChildren
      ? `Delete "${elementTitle}" and all its children? This cannot be undone.`
      : `Delete "${elementTitle}"? This cannot be undone.`

    if (!confirm(warning)) return

    try {
      const response = await fetch(`${this.baseUrl}/${elementId}`, {
        method: "DELETE",
        headers: {
          "Accept": "application/json",
          "X-CSRF-Token": this.csrfToken
        }
      })

      if (response.ok) {
        // If we deleted the current element, navigate to the project edit page without an element
        if (elementId === this.currentElementIdValue) {
          window.location.href = `/projects/${this.projectIdValue}/edit`
        } else {
          window.location.reload()
        }
      } else {
        alert("Failed to delete element.")
      }
    } catch (error) {
      console.error("Error deleting element:", error)
      alert("An error occurred.")
    }
  }

  // Private: create an element and navigate to it (or reload if container)
  async #createElement({ element_type, title, parent_id }) {
    try {
      // Calculate next position among siblings
      const siblings = parent_id
        ? this.element.querySelectorAll(`[data-element-id="${parent_id}"] > ul > li`)
        : this.treeTarget.children
      const position = siblings.length

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": this.csrfToken
        },
        body: JSON.stringify({
          source_element: {
            element_type,
            title,
            parent_id,
            source: "<p></p>",
            position
          }
        })
      })

      if (response.ok) {
        const created = await response.json()
        // Navigate to the new element if it's a content type, otherwise reload
        const contentTypes = ["section", "subsection", "introduction", "conclusion",
                              "preface", "appendix", "colophon", "references", "docinfo"]
        if (contentTypes.includes(element_type)) {
          window.location.href = `/projects/${this.projectIdValue}/edit?element=${created.id}`
        } else {
          window.location.reload()
        }
      } else {
        alert(`Failed to create ${element_type}.`)
      }
    } catch (error) {
      console.error("Error creating element:", error)
      alert("An error occurred.")
    }
  }
}
