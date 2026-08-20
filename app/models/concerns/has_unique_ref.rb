# Division, Asset and Snippet each carry a `ref` that must be unique not just
# within their own table but across all three -- a single `<plus:* ref="x"/>`
# placeholder namespace, since the tag name (not the ref) is what tells the
# resolver which pool to look in. `ref_sibling_classes` declares the other two
# for each includer, so a rename/create on any one model is checked against
# the other two without three copies of the same hand-rolled query.
#
# Siblings are declared by class NAME (a String), not by constant, and
# resolved lazily at validation time via `constantize`. All three includers
# reference each other, so resolving eagerly at class-body-eval time (as a
# bare constant reference would) risks each one's autoload triggering the
# next while the first is still mid-definition.
module HasUniqueRef
  extend ActiveSupport::Concern

  included do
    validates :ref, format: REF_REGEX, presence: true, uniqueness: { scope: :project }
    validate :ref_unique_among_siblings
  end

  class_methods do
    def ref_sibling_classes(*class_names)
      @ref_sibling_class_names = class_names.map(&:to_s)
    end

    def _ref_sibling_classes
      (@ref_sibling_class_names ||= []).map(&:constantize)
    end
  end

  private

  def ref_unique_among_siblings
    return unless project_id && ref

    self.class._ref_sibling_classes.each do |klass|
      if klass.where(project_id: project_id, ref: ref).exists?
        errors.add(:ref, "has already been taken")
        break
      end
    end
  end
end
