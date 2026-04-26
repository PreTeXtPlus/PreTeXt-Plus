# frozen_string_literal: true

module RuboCop
  module Cop
    module PretextPlus
      # Flags non-bang ActiveRecord writes inside transaction blocks.
      #
      # In a transaction, methods like update/save can fail without raising,
      # which prevents automatic rollback. Require bang variants so failures
      # raise and rollback the transaction.
      class TransactionRequiresBangWrites < Base
        MSG = "Use bang write methods inside transactions (for example update!, save!, create!) so failures raise and rollback."

        RESTRICT_ON_SEND = [ :transaction ].freeze
        NON_BANG_WRITES = %i[
          save
          update
          update_attributes
          create
          create_or_find_by
          create_with
          first_or_create
          first_or_create!
          find_or_create_by
          find_or_initialize_by
        ].freeze

        def on_send(node)
          return unless node.method?(:transaction)

          block = node.each_ancestor(:block).first
          return unless block && block.send_node == node

          block.body&.each_descendant(:send)&.each do |send_node|
            method_name = send_node.method_name
            next unless NON_BANG_WRITES.include?(method_name)

            add_offense(send_node.loc.selector)
          end
        end
      end
    end
  end
end
