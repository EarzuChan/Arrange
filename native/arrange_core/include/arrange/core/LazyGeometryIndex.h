#pragma once

#include <array>
#include <memory>
#include <vector>

namespace arrange::core {
    // 已知几何是集合索引账本，候选只复制块指针和本帧实际修改的块
    class LazyGeometryIndex {
       public:
        static constexpr std::size_t BlockSize = 256;

        float operator[](std::size_t index) const {
            return (*blocks_[index / BlockSize])[index % BlockSize];
        }

        void set(std::size_t index, float value) {
            auto& block = blocks_[index / BlockSize];
            if (block.use_count() != 1) block = std::make_shared<Block>(*block);
            (*block)[index % BlockSize] = value;
        }

        void add(std::size_t index, float value) {
            set(index, (*this)[index] + value);
        }

        void assign(std::size_t count, float value) {
            count_ = count;
            blocks_.clear();
            blocks_.reserve((count + BlockSize - 1) / BlockSize);
            for (std::size_t index = 0; index < count; index += BlockSize) {
                auto block = std::make_shared<Block>();
                block->fill(value);
                blocks_.push_back(std::move(block));
            }
        }

        std::size_t size() const {
            return count_;
        }

        bool empty() const {
            return count_ == 0;
        }

       private:
        using Block = std::array<float, BlockSize>;
        std::size_t count_ = 0;
        std::vector<std::shared_ptr<Block>> blocks_;
    };
}
