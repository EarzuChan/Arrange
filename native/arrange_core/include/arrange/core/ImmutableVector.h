#pragma once

#include <memory>
#include <utility>
#include <vector>

namespace arrange::core {
    template <typename T>
    class ImmutableVector {
       public:
        ImmutableVector() : values_(std::make_shared<const std::vector<T>>()) {}

        ImmutableVector(std::vector<T> values) : values_(std::make_shared<const std::vector<T>>(std::move(values))) {}

        ImmutableVector& operator=(std::vector<T> values) {
            values_ = std::make_shared<const std::vector<T>>(std::move(values));
            return *this;
        }

        const T& operator[](std::size_t index) const {
            return (*values_)[index];
        }

        const T& at(std::size_t index) const {
            return values_->at(index);
        }

        const T& front() const {
            return values_->front();
        }

        const T& back() const {
            return values_->back();
        }

        auto begin() const {
            return values_->begin();
        }

        auto end() const {
            return values_->end();
        }

        std::size_t size() const {
            return values_->size();
        }

        bool empty() const {
            return values_->empty();
        }

        const std::vector<T>& values() const {
            return *values_;
        }

        bool operator==(const ImmutableVector& other) const {
            return values_ == other.values_ || *values_ == *other.values_;
        }

       private:
        std::shared_ptr<const std::vector<T>> values_;
    };
}
