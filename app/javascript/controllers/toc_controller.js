import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { projectId: String }
  static targets = ["tree"]

  async addElement() {
    const title = prompt("Enter a title for the new section:")
    if (!title) return

    try {
      const response = await fetch(`/projects/${this.projectIdValue}/source_elements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
        },
        body: JSON.stringify({
          source_element: {
            element_type: "section",
            title: title,
            source: "<p></p>",
            position: this.treeTarget.children.length
          }
        })
      })

      if (response.ok) {
        const element = await response.json()
        window.location.href = `/projects/${this.projectIdValue}/edit?element=${element.id}`
      } else {
        alert("Failed to create section.")
      }
    } catch (error) {
      console.error("Error creating element:", error)
      alert("An error occurred.")
    }
  }
}
